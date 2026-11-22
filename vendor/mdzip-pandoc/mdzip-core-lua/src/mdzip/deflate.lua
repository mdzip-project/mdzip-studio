-- Raw DEFLATE compression (RFC 1951): LZ77 with hash chains, one block with
-- the fixed Huffman codes. Simple and dependency-free; good on text, which is
-- most of what an .mdz compresses. The writer stores an entry instead when
-- this doesn't make it smaller.
local M = {}

local byte, char, concat = string.byte, string.char, table.concat

local LEN_BASE = { 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258 }
local LEN_EXTRA = { 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0 }
local DIST_BASE = { 1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577 }
local DIST_EXTRA = { 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13 }

local function reverse(code, len)
  local r = 0
  for _ = 1, len do r = (r << 1) | (code & 1); code = code >> 1 end
  return r
end

-- Fixed Huffman codes (RFC 1951 3.2.6), bit-reversed for LSB-first output.
local LIT_CODE, LIT_LEN = {}, {}
for s = 0, 287 do
  local code, len
  if s <= 143 then code, len = 0x30 + s, 8
  elseif s <= 255 then code, len = 0x190 + (s - 144), 9
  elseif s <= 279 then code, len = s - 256, 7
  else code, len = 0xC0 + (s - 280), 8 end
  LIT_CODE[s], LIT_LEN[s] = reverse(code, len), len
end
local DIST_CODE = {}
for s = 0, 29 do DIST_CODE[s] = reverse(s, 5) end

-- Length 3..258 -> length code index (0..28); distance 1..32768 -> index (0..29).
local LEN_SYM = {}
for i = 1, 29 do
  for l = LEN_BASE[i], LEN_BASE[i] + (1 << LEN_EXTRA[i]) - 1 do
    if l <= 258 then LEN_SYM[l] = i - 1 end
  end
end
LEN_SYM[258] = 28
local function dist_sym(d)
  local lo, hi = 1, 30
  while lo < hi do
    local mid = (lo + hi + 1) // 2
    if DIST_BASE[mid] <= d then lo = mid else hi = mid - 1 end
  end
  return lo - 1
end

local WINDOW = 32768
local MAX_CHAIN = 48
local MIN_MATCH, MAX_MATCH = 3, 258

function M.deflate(s)
  local n = #s
  local out, no = {}, 0
  local acc, nbits = 0, 0
  local function put(value, len)
    acc = acc | (value << nbits)
    nbits = nbits + len
    while nbits >= 8 do
      no = no + 1; out[no] = acc & 0xFF
      acc = acc >> 8
      nbits = nbits - 8
    end
  end

  put(1, 1) -- final block
  put(1, 2) -- fixed Huffman codes

  local head, prev = {}, {}
  local function hash(i)
    local a, b, c = byte(s, i, i + 2)
    return (a << 16) | (b << 8) | c
  end

  local i = 1
  while i <= n do
    local best_len, best_dist = 0, 0
    if i + MIN_MATCH - 1 <= n then
      local h = hash(i)
      local cand = head[h]
      local chain = MAX_CHAIN
      local max_len = math.min(MAX_MATCH, n - i + 1)
      while cand and i - cand <= WINDOW and chain > 0 do
        if byte(s, cand + best_len) == byte(s, i + best_len) then
          local l = 0
          while l < max_len and byte(s, cand + l) == byte(s, i + l) do l = l + 1 end
          if l > best_len then
            best_len, best_dist = l, i - cand
            if l == max_len then break end
          end
        end
        cand = prev[cand]
        chain = chain - 1
      end
      prev[i] = head[h]
      head[h] = i
    end
    if best_len >= MIN_MATCH then
      local ls = LEN_SYM[best_len]
      put(LIT_CODE[257 + ls], LIT_LEN[257 + ls])
      if LEN_EXTRA[ls + 1] > 0 then put(best_len - LEN_BASE[ls + 1], LEN_EXTRA[ls + 1]) end
      local ds = dist_sym(best_dist)
      put(DIST_CODE[ds], 5)
      if DIST_EXTRA[ds + 1] > 0 then put(best_dist - DIST_BASE[ds + 1], DIST_EXTRA[ds + 1]) end
      -- Index the positions inside the match so later data can refer to them.
      for k = i + 1, math.min(i + best_len - 1, n - MIN_MATCH + 1) do
        local h = hash(k)
        prev[k] = head[h]
        head[h] = k
      end
      i = i + best_len
    else
      local b = byte(s, i)
      put(LIT_CODE[b], LIT_LEN[b])
      i = i + 1
    end
  end
  put(LIT_CODE[256], LIT_LEN[256]) -- end of block
  if nbits > 0 then put(0, 8 - nbits) end

  local parts = {}
  for k = 1, no, 4096 do
    parts[#parts + 1] = char(table.unpack(out, k, math.min(k + 4095, no)))
  end
  return concat(parts)
end

return M
