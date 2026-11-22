-- Raw DEFLATE decompression (RFC 1951) with a hard output limit.
--
-- inflate(data, first, last, max_out) decompresses data:sub(first, last) and
-- stops as soon as the output would exceed max_out bytes, so a ZIP entry that
-- lies about its size is caught after decompressing only what it declared
-- (spec 13.1). Raises:
--   { inflate = "limit" }   output would exceed max_out
--   { inflate = "invalid" } corrupt or truncated stream
local M = {}

local byte, char, concat, unpack = string.byte, string.char, table.concat, table.unpack

local function fail(kind) error({ inflate = kind }, 0) end

local LEN_BASE = { 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258 }
local LEN_EXTRA = { 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0 }
local DIST_BASE = { 1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577 }
local DIST_EXTRA = { 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13 }
local CL_ORDER = { 16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15 }

-- Build a decoding table from code lengths (lengths[0..n-1]).
-- Returns { bits = maxlen, [index] = symbol * 16 + length }, indexed by the
-- next maxlen input bits (LSB first).
local function build(lengths, n)
  local count = {}
  for l = 0, 15 do count[l] = 0 end
  local maxlen = 0
  for s = 0, n - 1 do
    local l = lengths[s] or 0
    count[l] = count[l] + 1
    if l > maxlen then maxlen = l end
  end
  local tbl = { bits = maxlen }
  if maxlen == 0 then return tbl end
  -- Reject over-subscribed codes; incomplete codes are allowed (RFC 1951 permits a single distance code).
  local left = 1
  for l = 1, 15 do
    left = left * 2 - count[l]
    if left < 0 then fail("invalid") end
  end
  local next_code, code = {}, 0
  count[0] = 0
  for l = 1, 15 do
    code = (code + count[l - 1]) << 1
    next_code[l] = code
  end
  local size = 1 << maxlen
  for s = 0, n - 1 do
    local l = lengths[s] or 0
    if l > 0 then
      local c = next_code[l]
      next_code[l] = c + 1
      local r = 0 -- reverse the l bits of c
      for _ = 1, l do r = (r << 1) | (c & 1); c = c >> 1 end
      local entry = s * 16 + l
      for idx = r, size - 1, 1 << l do tbl[idx] = entry end
    end
  end
  return tbl
end

local FIXED_LIT, FIXED_DIST
do
  local l = {}
  for s = 0, 143 do l[s] = 8 end
  for s = 144, 255 do l[s] = 9 end
  for s = 256, 279 do l[s] = 7 end
  for s = 280, 287 do l[s] = 8 end
  FIXED_LIT = build(l, 288)
  local d = {}
  for s = 0, 29 do d[s] = 5 end
  FIXED_DIST = build(d, 30)
end

local WINDOW = 32768
local FLUSH_AT = WINDOW * 4

function M.inflate(data, first, last, max_out)
  local pos = first
  local bitbuf, bitcnt, pad = 0, 0, 0

  local function need(n)
    while bitcnt < n do
      local b
      if pos <= last then b = byte(data, pos); pos = pos + 1
      else b = 0; pad = pad + 1; if pad > 4 then fail("invalid") end end
      bitbuf = bitbuf | (b << bitcnt)
      bitcnt = bitcnt + 8
    end
  end

  local function bits(n)
    if n == 0 then return 0 end
    need(n)
    local v = bitbuf & ((1 << n) - 1)
    bitbuf = bitbuf >> n
    bitcnt = bitcnt - n
    if bitcnt < pad * 8 then fail("invalid") end -- read past the end of the input
    return v
  end

  local function decode(tbl)
    local maxlen = tbl.bits
    if maxlen == 0 then fail("invalid") end
    need(maxlen)
    local entry = tbl[bitbuf & ((1 << maxlen) - 1)]
    if not entry then fail("invalid") end
    local len = entry & 15
    bitbuf = bitbuf >> len
    bitcnt = bitcnt - len
    if bitcnt < pad * 8 then fail("invalid") end
    return entry >> 4
  end

  -- Output: buf holds the most recent bytes (at least the last WINDOW);
  -- older bytes are flushed to parts as strings.
  local parts, np = {}, 0
  local buf, bn = {}, 0
  local total = 0

  local function flush(keep)
    local upto = bn - keep
    if upto <= 0 then return end
    for i = 1, upto, 4096 do
      np = np + 1
      parts[np] = char(unpack(buf, i, math.min(i + 4095, upto)))
    end
    local nb = {}
    for i = upto + 1, bn do nb[i - upto] = buf[i] end
    buf, bn = nb, bn - upto
  end

  local function check_room(n)
    if total + n > max_out then fail("limit") end
  end

  repeat
    local final = bits(1)
    local kind = bits(2)
    if kind == 0 then
      -- Stored block: drop to a byte boundary, then LEN and NLEN.
      bitbuf = bitbuf >> (bitcnt % 8)
      bitcnt = bitcnt - bitcnt % 8
      if pad > 0 then fail("invalid") end
      pos = pos - bitcnt // 8
      bitbuf, bitcnt = 0, 0
      if pos + 3 > last then fail("invalid") end
      local b1, b2, b3, b4 = byte(data, pos, pos + 3)
      local len, nlen = b1 | (b2 << 8), b3 | (b4 << 8)
      if len ~ 0xFFFF ~= nlen then fail("invalid") end
      pos = pos + 4
      if pos + len - 1 > last then fail("invalid") end
      check_room(len)
      for i = pos, pos + len - 1, 4096 do
        local chunk = { byte(data, i, math.min(i + 4095, pos + len - 1)) }
        for k = 1, #chunk do bn = bn + 1; buf[bn] = chunk[k] end
      end
      total = total + len
      pos = pos + len
      if bn > FLUSH_AT then flush(WINDOW) end
    elseif kind == 1 or kind == 2 then
      local lit, dist
      if kind == 1 then
        lit, dist = FIXED_LIT, FIXED_DIST
      else
        local hlit, hdist, hclen = bits(5) + 257, bits(5) + 1, bits(4) + 4
        if hlit > 286 or hdist > 30 then fail("invalid") end
        local cl = {}
        for i = 1, hclen do cl[CL_ORDER[i]] = bits(3) end
        local cl_tbl = build(cl, 19)
        local lengths, n = {}, 0
        while n < hlit + hdist do
          local sym = decode(cl_tbl)
          if sym < 16 then
            lengths[n] = sym; n = n + 1
          else
            local rep, val
            if sym == 16 then
              if n == 0 then fail("invalid") end
              val, rep = lengths[n - 1], 3 + bits(2)
            elseif sym == 17 then
              val, rep = 0, 3 + bits(3)
            else
              val, rep = 0, 11 + bits(7)
            end
            if n + rep > hlit + hdist then fail("invalid") end
            for _ = 1, rep do lengths[n] = val; n = n + 1 end
          end
        end
        if (lengths[256] or 0) == 0 then fail("invalid") end -- no end-of-block code
        local ll, dl = {}, {}
        for i = 0, hlit - 1 do ll[i] = lengths[i] end
        for i = 0, hdist - 1 do dl[i] = lengths[hlit + i] end
        lit, dist = build(ll, hlit), build(dl, hdist)
      end
      while true do
        local sym = decode(lit)
        if sym < 256 then
          check_room(1)
          bn = bn + 1; buf[bn] = sym; total = total + 1
        elseif sym == 256 then
          break
        else
          sym = sym - 257
          if sym >= 29 then fail("invalid") end
          local len = LEN_BASE[sym + 1] + bits(LEN_EXTRA[sym + 1])
          local dsym = decode(dist)
          if dsym >= 30 then fail("invalid") end
          local d = DIST_BASE[dsym + 1] + bits(DIST_EXTRA[dsym + 1])
          if d > total or d > bn then fail("invalid") end
          check_room(len)
          local src = bn - d
          for i = 1, len do buf[bn + i] = buf[src + i] end
          bn = bn + len
          total = total + len
        end
        if bn > FLUSH_AT then flush(WINDOW) end
      end
    else
      fail("invalid")
    end
  until final == 1

  flush(0)
  return concat(parts, "", 1, np)
end

return M
