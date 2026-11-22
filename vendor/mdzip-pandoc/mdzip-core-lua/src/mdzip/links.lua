-- Link resolution inside an archive (spec 9.3).
--
-- This library resolves standard Markdown link destinations against the
-- archive only. Links outside the archive (9.4) and into other archives (9.5)
-- are optional and not supported: they come back unresolved, never as a
-- different target, and `..` is never clamped at the archive root.
local unicode = require("mdzip.unicode")
local entrypoint = require("mdzip.entrypoint")

local M = {}

-- Result kinds and reasons.
--   { kind = "internal", entry = <stored name>, fragment = <string|nil> }
--   { kind = "url", url = <destination> }
--   { kind = "unresolved", reason = "not-found" | "invalid" | "unsupported", fragment = ... }
local function unresolved(reason, fragment)
  return { kind = "unresolved", reason = reason, fragment = fragment }
end

-- Percent-decode one segment, exactly once, as UTF-8 (spec 9.3 step 4).
-- Returns nil for invalid encoding or bytes that aren't UTF-8.
local function percent_decode(segment)
  if not segment:find("%", 1, true) then
    return unicode.is_utf8(segment) and segment or nil
  end
  local out, i, n = {}, 1, #segment
  while i <= n do
    local c = segment:sub(i, i)
    if c == "%" then
      local hex = segment:sub(i + 1, i + 2)
      if not hex:match("^%x%x$") then return nil end
      out[#out + 1] = string.char(tonumber(hex, 16))
      i = i + 3
    else
      out[#out + 1] = c
      i = i + 1
    end
  end
  local decoded = table.concat(out)
  if not unicode.is_utf8(decoded) then return nil end
  return decoded
end

-- resolve(idx, from, link[, options]) -> result
--   idx      entrypoint.index() of the archive's regular files
--   from     stored path of the referencing document
--   link     the destination as written
--   options  { use = "navigate" | "embed" } (no effect inside an archive)
function M.resolve(idx, from, link)
  if type(link) ~= "string" then return unresolved("invalid") end
  -- A destination with a URL scheme is not a path (spec 9.2).
  if link:match("^[A-Za-z][A-Za-z0-9+.%-]*:") then return { kind = "url", url = link } end
  local before, fragment = link, nil
  local hash = link:find("#", 1, true)
  if hash then before, fragment = link:sub(1, hash - 1), link:sub(hash + 1) end
  local q = before:find("?", 1, true)
  if q then before = before:sub(1, q - 1) end
  if before == "" then
    return { kind = "internal", entry = from, fragment = fragment }
  end
  if before:sub(1, 1) == "/" or before:find("\\", 1, true) then return unresolved("invalid", fragment) end
  local names_directory = before:sub(-1) == "/"

  -- Start in the directory of the referencing file.
  local stack = {}
  for seg in from:gmatch("([^/]+)/") do stack[#stack + 1] = seg end

  for raw in (before .. "/"):gmatch("(.-)/") do
    local seg = percent_decode(raw)
    if seg == nil or seg:find("[/\\%c]") then return unresolved("invalid", fragment) end
    if seg == "" or seg == "." then
      -- stay
    elseif seg == ".." then
      if #stack == 0 then
        -- The link leaves the archive (spec 9.4): not supported here.
        return unresolved("unsupported", fragment)
      end
      stack[#stack] = nil
    else
      stack[#stack + 1] = seg
    end
  end
  if names_directory or #stack == 0 then return unresolved("not-found", fragment) end
  local found = entrypoint.find(idx, table.concat(stack, "/"))
  if not found then return unresolved("not-found", fragment) end
  return { kind = "internal", entry = found, fragment = fragment }
end

return M
