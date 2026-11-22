-- Strict JSON (RFC 8259) for manifest.json.
--
-- Values: strings, numbers (integers stay integers), booleans, json.null,
-- objects and arrays. Objects and arrays are Lua tables with a metatable, so
-- {} and [] stay distinct and member order survives a rewrite. Index an object
-- like any table (obj.title); assigning nil removes a member. Arrays use 1..n.
--
-- decode() reports duplicate member names as JSON pointers; the last
-- occurrence wins (spec 6.4).
local M = {}

local null = setmetatable({}, { __tostring = function() return "null" end, __name = "json.null" })
M.null = null

local OBJECT = { __name = "json.object" }
local ARRAY = { __name = "json.array" }
local key_order = setmetatable({}, { __mode = "k" }) -- object -> list of keys

function M.object(t)
  local obj = setmetatable({}, OBJECT)
  local order = {}
  key_order[obj] = order
  if t then
    local keys = {}
    for k in pairs(t) do keys[#keys + 1] = k end
    table.sort(keys)
    for _, k in ipairs(keys) do obj[k] = t[k]; order[#order + 1] = k end
  end
  return obj
end

function M.array(t)
  local arr = setmetatable({}, ARRAY)
  if t then for i = 1, #t do arr[i] = t[i] end end
  return arr
end

function M.is_object(v) return type(v) == "table" and getmetatable(v) == OBJECT end
function M.is_array(v) return type(v) == "table" and getmetatable(v) == ARRAY end

-- Keys of an object in their original order, then any added later (sorted).
function M.keys(obj)
  local out, seen = {}, {}
  for _, k in ipairs(key_order[obj] or {}) do
    if obj[k] ~= nil and not seen[k] then out[#out + 1] = k; seen[k] = true end
  end
  local extra = {}
  for k in pairs(obj) do
    if not seen[k] then extra[#extra + 1] = k end
  end
  table.sort(extra)
  for _, k in ipairs(extra) do out[#out + 1] = k end
  return out
end

-- Set a member, keeping its position if it exists.
function M.set(obj, key, value)
  if obj[key] == nil and value ~= nil then
    local order = key_order[obj]
    if not order then order = {}; key_order[obj] = order end
    order[#order + 1] = key
  end
  obj[key] = value
end

---------------------------------------------------------------------------
-- Decoding

local MAX_DEPTH = 512
local byte, sub, find, char = string.byte, string.sub, string.find, string.char

local function decode_error(msg, pos)
  error({ json_error = msg .. " at byte " .. pos }, 0)
end

local ESCAPES = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }

local function escape_pointer(key)
  return (key:gsub("~", "~0"):gsub("/", "~1"))
end

function M.decode(text)
  if type(text) ~= "string" then return nil, "not a string" end
  local pos = 1
  if sub(text, 1, 3) == "\239\187\191" then pos = 4 end -- tolerate a UTF-8 BOM
  local duplicates = {}

  local function skip_ws()
    pos = find(text, "[^ \t\r\n]", pos) or (#text + 1)
  end

  local parse_value

  local function parse_string()
    local start = pos + 1 -- after the opening quote
    local parts, n = {}, 0
    local i = start
    while true do
      local j = find(text, '["\\%c]', i)
      if not j then decode_error("unterminated string", start) end
      local c = sub(text, j, j)
      if c == '"' then
        n = n + 1; parts[n] = sub(text, i, j - 1)
        pos = j + 1
        break
      elseif c == "\\" then
        n = n + 1; parts[n] = sub(text, i, j - 1)
        local e = sub(text, j + 1, j + 1)
        if ESCAPES[e] then
          n = n + 1; parts[n] = ESCAPES[e]
          i = j + 2
        elseif e == "u" then
          local hex = sub(text, j + 2, j + 5)
          if not hex:match("^%x%x%x%x$") then decode_error("invalid \\u escape", j) end
          local cp = tonumber(hex, 16)
          i = j + 6
          if cp >= 0xD800 and cp <= 0xDBFF then
            local hex2 = text:match("^\\u(%x%x%x%x)", i)
            local low = hex2 and tonumber(hex2, 16)
            if not low or low < 0xDC00 or low > 0xDFFF then decode_error("unpaired surrogate", j) end
            cp = 0x10000 + (cp - 0xD800) * 0x400 + (low - 0xDC00)
            i = i + 6
          elseif cp >= 0xDC00 and cp <= 0xDFFF then
            decode_error("unpaired surrogate", j)
          end
          n = n + 1; parts[n] = utf8.char(cp)
        else
          decode_error("invalid escape", j)
        end
      else
        decode_error("control character in string", j)
      end
    end
    return table.concat(parts, "", 1, n)
  end

  local function parse_number()
    local s, e = find(text, "^-?%d+", pos)
    if not s then decode_error("invalid number", pos) end
    local int_part = sub(text, s, e):gsub("^-", "")
    if #int_part > 1 and int_part:sub(1, 1) == "0" then decode_error("leading zero in number", pos) end
    local is_float = false
    local fs, fe = find(text, "^%.%d+", e + 1)
    if fs then e = fe; is_float = true
    elseif sub(text, e + 1, e + 1) == "." then decode_error("invalid number", e + 1) end
    local xs, xe = find(text, "^[eE][+-]?%d+", e + 1)
    if xs then e = xe; is_float = true
    elseif find(text, "^[eE]", e + 1) then decode_error("invalid number", e + 1) end
    local lexeme = sub(text, pos, e)
    pos = e + 1
    if not is_float then
      local i = math.tointeger(tonumber(lexeme))
      if i and tostring(i) == lexeme:gsub("^%-0$", "0") then return i end
    end
    local f = tonumber(lexeme)
    if f == nil then decode_error("invalid number", pos) end
    return f + 0.0
  end

  function parse_value(depth, pointer)
    if depth > MAX_DEPTH then decode_error("nesting too deep", pos) end
    skip_ws()
    local c = sub(text, pos, pos)
    if c == "{" then
      pos = pos + 1
      local obj = M.object()
      local order = key_order[obj]
      skip_ws()
      if sub(text, pos, pos) == "}" then pos = pos + 1; return obj end
      while true do
        skip_ws()
        if sub(text, pos, pos) ~= '"' then decode_error("expected member name", pos) end
        local key = parse_string()
        skip_ws()
        if sub(text, pos, pos) ~= ":" then decode_error("expected ':'", pos) end
        pos = pos + 1
        local member_pointer = pointer .. "/" .. escape_pointer(key)
        local value = parse_value(depth + 1, member_pointer)
        if obj[key] ~= nil then
          duplicates[#duplicates + 1] = member_pointer
        else
          order[#order + 1] = key
        end
        obj[key] = value
        skip_ws()
        local d = sub(text, pos, pos)
        pos = pos + 1
        if d == "}" then return obj end
        if d ~= "," then decode_error("expected ',' or '}'", pos - 1) end
      end
    elseif c == "[" then
      pos = pos + 1
      local arr = M.array()
      skip_ws()
      if sub(text, pos, pos) == "]" then pos = pos + 1; return arr end
      local n = 0
      while true do
        n = n + 1
        arr[n] = parse_value(depth + 1, pointer .. "/" .. (n - 1))
        skip_ws()
        local d = sub(text, pos, pos)
        pos = pos + 1
        if d == "]" then return arr end
        if d ~= "," then decode_error("expected ',' or ']'", pos - 1) end
      end
    elseif c == '"' then
      return parse_string()
    elseif c == "-" or (c >= "0" and c <= "9" and c ~= "") then
      return parse_number()
    elseif sub(text, pos, pos + 3) == "true" then pos = pos + 4; return true
    elseif sub(text, pos, pos + 4) == "false" then pos = pos + 5; return false
    elseif sub(text, pos, pos + 3) == "null" then pos = pos + 4; return null
    end
    decode_error("unexpected character", pos)
  end

  local ok, result = pcall(function()
    local v = parse_value(1, "")
    skip_ws()
    if pos <= #text then decode_error("trailing data", pos) end
    return v
  end)
  if not ok then
    if type(result) == "table" and result.json_error then return nil, result.json_error end
    error(result, 0)
  end
  return result, duplicates
end

---------------------------------------------------------------------------
-- Encoding

local function encode_string(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    if c == '"' then return '\\"' elseif c == "\\" then return "\\\\"
    elseif c == "\n" then return "\\n" elseif c == "\r" then return "\\r"
    elseif c == "\t" then return "\\t" elseif c == "\b" then return "\\b"
    elseif c == "\f" then return "\\f" end
    return string.format("\\u%04x", byte(c))
  end) .. '"'
end

local function encode_number(n)
  if math.type(n) == "integer" then return tostring(n) end
  if n ~= n or n == math.huge or n == -math.huge then error("cannot encode a non-finite number in JSON", 0) end
  if n == math.floor(n) and math.abs(n) < 2 ^ 53 then return string.format("%.1f", n) end
  for digits = 15, 17 do
    local s = string.format("%." .. digits .. "g", n)
    if tonumber(s) == n then return s end
  end
  return string.format("%.17g", n)
end

local function is_plain_array(t)
  local n = 0
  for k in pairs(t) do
    if math.type(k) ~= "integer" or k < 1 then return false end
    n = n + 1
  end
  for i = 1, n do if t[i] == nil then return false end end
  return true
end

local function encode_value(v, indent, out)
  local tv = type(v)
  if v == null then out[#out + 1] = "null"
  elseif tv == "string" then out[#out + 1] = encode_string(v)
  elseif tv == "number" then out[#out + 1] = encode_number(v)
  elseif tv == "boolean" then out[#out + 1] = tostring(v)
  elseif tv == "table" then
    local inner = indent .. "  "
    local as_array = M.is_array(v) or (not M.is_object(v) and next(v) ~= nil and is_plain_array(v))
    if as_array then
      if #v == 0 then out[#out + 1] = "[]"; return end
      out[#out + 1] = "[\n"
      for i = 1, #v do
        out[#out + 1] = inner
        encode_value(v[i], inner, out)
        out[#out + 1] = i < #v and ",\n" or "\n"
      end
      out[#out + 1] = indent .. "]"
    else
      local keys = M.is_object(v) and M.keys(v) or (function()
        local ks = {}
        for k in pairs(v) do
          if type(k) ~= "string" then error("JSON object keys must be strings", 0) end
          ks[#ks + 1] = k
        end
        table.sort(ks)
        return ks
      end)()
      if #keys == 0 then out[#out + 1] = "{}"; return end
      out[#out + 1] = "{\n"
      for i, k in ipairs(keys) do
        out[#out + 1] = inner .. encode_string(k) .. ": "
        encode_value(v[k], inner, out)
        out[#out + 1] = i < #keys and ",\n" or "\n"
      end
      out[#out + 1] = indent .. "}"
    end
  else
    error("cannot encode a " .. tv .. " in JSON", 0)
  end
end

-- Encode with two-space indentation and LF line endings, plus a final LF.
-- Plain Lua tables are accepted too: sequences become arrays, others objects
-- with sorted keys.
function M.encode(v)
  local out = {}
  encode_value(v, "", out)
  out[#out + 1] = "\n"
  return table.concat(out)
end

---------------------------------------------------------------------------
-- Helpers

-- Read a JSON pointer (RFC 6901). Returns the value or nil.
function M.pointer(v, pointer)
  if pointer == "" then return v end
  for token in pointer:gmatch("/([^/]*)") do
    token = token:gsub("~1", "/"):gsub("~0", "~")
    if M.is_array(v) then
      local i = tonumber(token)
      if not i then return nil end
      v = v[i + 1]
    elseif type(v) == "table" and v ~= null then
      v = v[token]
    else
      return nil
    end
    if v == nil then return nil end
  end
  return v
end

-- JSON equality: numbers by value, objects regardless of member order.
function M.equal(a, b)
  if type(a) ~= type(b) then return false end
  if type(a) ~= "table" or a == null or b == null then
    if type(a) == "number" then return a == b end
    return a == b
  end
  if M.is_array(a) ~= M.is_array(b) then return false end
  if M.is_array(a) then
    if #a ~= #b then return false end
    for i = 1, #a do if not M.equal(a[i], b[i]) then return false end end
    return true
  end
  for k, va in pairs(a) do if not M.equal(va, b[k]) then return false end end
  for k in pairs(b) do if a[k] == nil then return false end end
  return true
end

-- Deep copy, keeping object/array kinds and member order.
function M.copy(v)
  if type(v) ~= "table" or v == null then return v end
  if M.is_array(v) then
    local a = M.array()
    for i = 1, #v do a[i] = M.copy(v[i]) end
    return a
  end
  local o = M.object()
  for _, k in ipairs(M.keys(v)) do M.set(o, k, M.copy(v[k])) end
  return o
end

return M
