-- NFC normalization, Unicode default case folding and UTF-8 checks.
-- Paths are matched after NFC (spec 5.4.1); case folding is used only to warn
-- about names that differ only in case (spec 5.4), never to match them.
local data = require("mdzip.unicode_data")

local M = {}

local ccc, decomp, comp, fold = data.ccc, data.decomp, data.comp, data.fold
local utf8_char, utf8_codes, utf8_len = utf8.char, utf8.codes, utf8.len
local concat = table.concat

-- Hangul syllables are composed and decomposed algorithmically.
local S_BASE, L_BASE, V_BASE, T_BASE = 0xAC00, 0x1100, 0x1161, 0x11A7
local L_COUNT, V_COUNT, T_COUNT = 19, 21, 28
local N_COUNT = V_COUNT * T_COUNT
local S_COUNT = L_COUNT * N_COUNT

M.unicode_version = data.version

-- True when s is valid UTF-8 (no overlongs, surrogates or code points above
-- U+10FFFF). Surrogates are checked here because Lua 5.3's utf8.len accepts them.
function M.is_utf8(s)
  return utf8_len(s) ~= nil and not s:find("\237[\160-\191]")
end

local function is_ascii(s)
  return not s:find("[\128-\255]")
end
M.is_ascii = is_ascii

local function decompose(s)
  local out, n = {}, 0
  for _, cp in utf8_codes(s) do
    local s_index = cp - S_BASE
    if s_index >= 0 and s_index < S_COUNT then
      n = n + 1; out[n] = L_BASE + s_index // N_COUNT
      n = n + 1; out[n] = V_BASE + (s_index % N_COUNT) // T_COUNT
      local t = s_index % T_COUNT
      if t ~= 0 then n = n + 1; out[n] = T_BASE + t end
    else
      local d = decomp[cp]
      if d then
        for i = 1, #d do n = n + 1; out[n] = d[i] end
      else
        n = n + 1; out[n] = cp
      end
    end
  end
  -- Canonical ordering: stable sort of each run of non-starters by class.
  local i = 1
  while i <= n do
    if (ccc[out[i]] or 0) ~= 0 then
      local j = i
      while j + 1 <= n and (ccc[out[j + 1]] or 0) ~= 0 do j = j + 1 end
      for a = i + 1, j do -- insertion sort keeps equal classes in order
        local v, cv = out[a], ccc[out[a]]
        local b = a - 1
        while b >= i and ccc[out[b]] > cv do out[b + 1] = out[b]; b = b - 1 end
        out[b + 1] = v
      end
      i = j + 1
    else
      i = i + 1
    end
  end
  return out, n
end

local function compose_pair(a, b)
  local l_index, v_index = a - L_BASE, b - V_BASE
  if l_index >= 0 and l_index < L_COUNT and v_index >= 0 and v_index < V_COUNT then
    return S_BASE + (l_index * V_COUNT + v_index) * T_COUNT
  end
  local s_index, t_index = a - S_BASE, b - T_BASE
  if s_index >= 0 and s_index < S_COUNT and s_index % T_COUNT == 0 and t_index > 0 and t_index < T_COUNT then
    return a + t_index
  end
  local row = comp[a]
  return row and row[b]
end

-- Unicode Normalization Form C. Expects valid UTF-8.
function M.nfc(s)
  if is_ascii(s) then return s end
  local cps, n = decompose(s)
  if n == 0 then return s end
  local out, m = { cps[1] }, 1
  local starter = (ccc[cps[1]] or 0) == 0 and 1 or nil
  local last_class = starter and 0 or (ccc[cps[1]] or 0)
  for i = 2, n do
    local cp = cps[i]
    local class = ccc[cp] or 0
    local composed = nil
    -- A character is blocked from the starter if a character between them has
    -- class 0 or a class >= its own.
    if starter and (last_class < class or (last_class == 0 and m == starter)) then
      composed = compose_pair(out[starter], cp)
    end
    if composed then
      out[starter] = composed
    else
      m = m + 1; out[m] = cp
      if class == 0 then starter = m end
      last_class = class
    end
  end
  for k = 1, m do out[k] = utf8_char(out[k]) end
  return concat(out, "", 1, m)
end

-- Unicode default case folding (CaseFolding.txt statuses C and F).
function M.casefold(s)
  local out, n, changed = {}, 0, false
  for _, cp in utf8_codes(s) do
    local f = fold[cp]
    if f then
      changed = true
      for i = 1, #f do n = n + 1; out[n] = utf8_char(f[i]) end
    else
      n = n + 1; out[n] = utf8_char(cp)
    end
  end
  if not changed then return s end
  return concat(out)
end

-- Key for "differ only in case" checks: equal when the paths collide on a
-- case-insensitive filesystem (spec 5.4).
function M.case_key(s)
  return M.nfc(M.casefold(M.nfc(s)))
end

-- ASCII-only lowercase, for the fixed names the spec compares
-- case-insensitively (spec 5.4.1). Never locale-dependent.
function M.ascii_lower(s)
  return (s:gsub("[A-Z]", function(c) return string.char(c:byte() + 32) end))
end

return M
