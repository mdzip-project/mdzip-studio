-- Error values. Every failure is a table with a stable `code` (the spec's
-- ERR_* names, Section 16.5), a human-readable `message`, and, where it
-- applies, the archive `path` involved. tostring(err) gives "CODE: message".
local M = {}

M.codes = {
  ZIP_INVALID = "ERR_ZIP_INVALID",
  ZIP_ENCRYPTED = "ERR_ZIP_ENCRYPTED",
  PATH_INVALID = "ERR_PATH_INVALID",
  PATH_CONFLICT = "ERR_PATH_CONFLICT",
  DUPLICATE_PATH = "ERR_DUPLICATE_PATH",
  MANIFEST_INVALID = "ERR_MANIFEST_INVALID",
  ENTRYPOINT_UNRESOLVED = "ERR_ENTRYPOINT_UNRESOLVED",
  ENTRYPOINT_INVALID = "ERR_ENTRYPOINT_INVALID",
  ENTRYPOINT_MISSING = "ERR_ENTRYPOINT_MISSING",
  VERSION_UNSUPPORTED = "ERR_VERSION_UNSUPPORTED",
  MODE_UNSUPPORTED = "ERR_MODE_UNSUPPORTED",
  LIMIT_EXCEEDED = "ERR_LIMIT_EXCEEDED",
  -- Not spec codes: failures of the library's own API.
  NOT_FOUND = "ERR_NOT_FOUND",         -- no entry with that exact path
  TEXT_INVALID = "ERR_TEXT_INVALID",   -- entry is not valid UTF-8
  IO = "ERR_IO",                       -- reading or writing a host file failed
  ARGUMENT = "ERR_ARGUMENT",           -- the caller passed something unusable
}

local Error = {}
Error.__index = Error
Error.__tostring = function(e)
  if e.path then return e.code .. ": " .. e.message .. " (" .. e.path .. ")" end
  return e.code .. ": " .. e.message
end

-- new(code, message[, fields]) -> error table
function M.new(code, message, fields)
  local e = setmetatable({ code = code, message = message }, Error)
  if fields then for k, v in pairs(fields) do e[k] = v end end
  return e
end

function M.is_error(v)
  return getmetatable(v) == Error
end

-- Raise an error value; caught by M.catch at the public API boundary.
function M.raise(code, message, fields)
  error(M.new(code, message, fields), 0)
end

-- Run fn(...) and turn raised error values into `nil, err` (the usual Lua
-- convention for expected failures). Anything else is a bug and re-raised.
function M.catch(fn, ...)
  local results = table.pack(pcall(fn, ...))
  if results[1] then return table.unpack(results, 2, results.n) end
  local e = results[2]
  if M.is_error(e) then return nil, e end
  error(e, 0)
end

return M
