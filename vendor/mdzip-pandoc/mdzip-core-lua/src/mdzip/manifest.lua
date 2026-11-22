-- manifest.json parsing and validation (spec 6).
local json = require("mdzip.json")
local errors = require("mdzip.errors")
local unicode = require("mdzip.unicode")
local paths = require("mdzip.paths")

local M = {}
local C = errors.codes

M.SPEC_NAME = "mdzip-spec"
M.SPEC_VERSION = "1.2.0"   -- written to new manifests (the 1.2.x format; 1.2.1 changed no rules)
M.SUPPORTED_MAJOR = 1
M.MODES = { document = true, project = true }

-- Warning codes (not spec codes): the archive still opens.
M.warnings = {
  FIELD_IGNORED = "WARN_MANIFEST_FIELD_IGNORED",       -- descriptive field with a wrong type or value
  DUPLICATE_MEMBER = "WARN_MANIFEST_DUPLICATE_MEMBER", -- the same member name twice in one object
  VERSION_OLD = "WARN_SPEC_VERSION_OLD",               -- spec.version major below 1
}
local W = M.warnings

-- Semantic Versioning 2.0.0. Returns the major version, or nil.
function M.semver_major(s)
  if type(s) ~= "string" then return nil end
  local core, rest = s:match("^(%d+%.%d+%.%d+)(.*)$")
  if not core then return nil end
  for part in core:gmatch("%d+") do
    if #part > 1 and part:sub(1, 1) == "0" then return nil end
  end
  local pre, build = rest:match("^%-([^+]*)(.*)$")
  if pre then
    if pre == "" then return nil end
    for id in (pre .. "."):gmatch("([^.]*)%.") do
      if id == "" or not id:match("^[0-9A-Za-z-]+$") then return nil end
      if id:match("^%d+$") and #id > 1 and id:sub(1, 1) == "0" then return nil end
    end
    rest = build
  end
  if rest ~= "" then
    local b = rest:match("^%+(.+)$")
    if not b then return nil end
    for id in (b .. "."):gmatch("([^.]*)%.") do
      if id == "" or not id:match("^[0-9A-Za-z-]+$") then return nil end
    end
  end
  return tonumber(core:match("^(%d+)"))
end

local function leap(y) return (y % 4 == 0 and y % 100 ~= 0) or y % 400 == 0 end
local DAYS = { 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 }

-- RFC 3339 date-time (the JSON Schema "date-time" format).
function M.is_rfc3339(s)
  if type(s) ~= "string" then return false end
  local y, mo, d, h, mi, sec, rest = s:match("^(%d%d%d%d)%-(%d%d)%-(%d%d)[Tt](%d%d):(%d%d):(%d%d)(.*)$")
  if not y then return false end
  y, mo, d, h, mi, sec = tonumber(y), tonumber(mo), tonumber(d), tonumber(h), tonumber(mi), tonumber(sec)
  if mo < 1 or mo > 12 or d < 1 then return false end
  local max_day = DAYS[mo] + ((mo == 2 and leap(y)) and 1 or 0)
  if d > max_day or h > 23 or mi > 59 or sec > 60 then return false end
  rest = rest:gsub("^%.%d+", "")
  if rest == "Z" or rest == "z" then return true end
  local oh, om = rest:match("^[+-](%d%d):(%d%d)$")
  return oh ~= nil and tonumber(oh) <= 23 and tonumber(om) <= 59
end

local function is_string(v) return type(v) == "string" end
local function is_nonempty_string(v) return type(v) == "string" and v ~= "" end

-- An object whose listed members, when present, are strings.
local function string_members(v, names)
  if not json.is_object(v) then return false end
  for _, k in ipairs(names) do
    if v[k] ~= nil and not is_string(v[k]) then return false end
  end
  return true
end

local PERSON = { "name", "email", "url" }

local function valid_stamp(v)
  if is_string(v) then return M.is_rfc3339(v) end -- legacy 1.0.x form
  if not json.is_object(v) then return false end
  if not M.is_rfc3339(v.when) then return false end
  if v.by ~= nil and not string_members(v.by, PERSON) then return false end
  return true
end

-- Descriptive fields (spec 6.2) and how to check them. A field that fails is
-- ignored with a warning (spec 6.4).
local DESCRIPTIVE = {
  { "title", is_nonempty_string },
  { "language", function(v) -- BCP 47 shape: a letter-led first subtag, then "-"-separated alphanumeric subtags of 1-8
      if not is_string(v) or v == "" then return false end
      local first = true
      for part in (v .. "-"):gmatch("([^-]*)%-") do
        if #part < 1 or #part > 8 or not part:match("^[A-Za-z0-9]+$") then return false end
        if first and not part:match("^[A-Za-z]+$") then return false end
        first = false
      end
      return true
    end },
  { "description", is_string },
  { "version", is_string },
  { "license", is_nonempty_string },
  { "keywords", function(v)
      if not json.is_array(v) then return false end
      for i = 1, #v do if not is_string(v[i]) then return false end end
      return true
    end },
  { "cover", function(v) return paths.normalize_manifest_path(v) ~= nil end },
  { "author", function(v) return string_members(v, PERSON) end },
  { "producer", function(v)
      if not json.is_object(v) then return false end
      for _, part in ipairs({ "application", "core" }) do
        if v[part] ~= nil and not string_members(v[part], { "name", "version", "url" }) then return false end
      end
      return true
    end },
  { "created", valid_stamp },
  { "modified", valid_stamp },
}

-- Check a decoded manifest value. Returns errors, warnings (lists of error
-- values). Critical fields (spec, spec.version, mode, entryPoint) are errors;
-- descriptive fields are warnings.
function M.check(obj)
  local errs, warns = {}, {}
  if not json.is_object(obj) then
    errs[1] = errors.new(C.MANIFEST_INVALID, "manifest.json's top-level value is not an object", { path = "manifest.json" })
    return errs, warns
  end
  local spec = obj.spec
  if spec ~= nil then
    if not json.is_object(spec) then
      errs[#errs + 1] = errors.new(C.MANIFEST_INVALID, "manifest spec is not an object", { path = "manifest.json", field = "spec" })
    else
      local v = spec.version
      if v ~= nil then
        local major = M.semver_major(v)
        if not major then
          errs[#errs + 1] = errors.new(C.MANIFEST_INVALID, "manifest spec.version is not a Semantic Versioning string",
            { path = "manifest.json", field = "spec.version" })
        elseif major > M.SUPPORTED_MAJOR then
          errs[#errs + 1] = errors.new(C.VERSION_UNSUPPORTED, "archive targets spec " .. v .. "; this library supports major version "
            .. M.SUPPORTED_MAJOR, { path = "manifest.json", field = "spec.version" })
        elseif major < M.SUPPORTED_MAJOR then
          warns[#warns + 1] = errors.new(W.VERSION_OLD, "archive targets spec " .. v .. ", an older major version",
            { path = "manifest.json", field = "spec.version" })
        end
      end
      if spec.name ~= nil and not is_string(spec.name) then
        warns[#warns + 1] = errors.new(W.FIELD_IGNORED, "spec.name is not a string; ignored", { path = "manifest.json", field = "spec.name" })
      end
    end
  end
  local mode = obj.mode
  if mode ~= nil then
    if not is_string(mode) then
      errs[#errs + 1] = errors.new(C.MANIFEST_INVALID, "manifest mode is not a string", { path = "manifest.json", field = "mode" })
    elseif not M.MODES[mode] then
      errs[#errs + 1] = errors.new(C.MODE_UNSUPPORTED, "manifest mode \"" .. mode .. "\" is not recognized",
        { path = "manifest.json", field = "mode", mode = mode })
    end
  end
  if obj.entryPoint ~= nil and not paths.normalize_entry_point(obj.entryPoint) then
    errs[#errs + 1] = errors.new(C.ENTRYPOINT_INVALID, "manifest entryPoint is not a valid entry point path",
      { path = "manifest.json", field = "entryPoint" })
  end
  for _, d in ipairs(DESCRIPTIVE) do
    local name, ok = d[1], d[2]
    if obj[name] ~= nil and not ok(obj[name]) then
      warns[#warns + 1] = errors.new(W.FIELD_IGNORED, "manifest " .. name .. " has a wrong type or value; ignored",
        { path = "manifest.json", field = name })
    end
  end
  return errs, warns
end

-- Parse manifest.json bytes. Returns a state table:
--   manifest   the decoded object (nil when unreadable)
--   errors     list of error values; the first is the one to report
--   warnings   ignored fields, duplicate members, old version
function M.parse(bytes)
  local state = { errors = {}, warnings = {} }
  if not unicode.is_utf8(bytes) then
    state.errors[1] = errors.new(C.MANIFEST_INVALID, "manifest.json is not valid UTF-8", { path = "manifest.json" })
    return state
  end
  local value, dups = json.decode(bytes)
  if value == nil then
    state.errors[1] = errors.new(C.MANIFEST_INVALID, "manifest.json is not valid JSON: " .. tostring(dups), { path = "manifest.json" })
    return state
  end
  local errs, warns = M.check(value)
  state.errors = errs
  if json.is_object(value) then state.manifest = value end
  for _, pointer in ipairs(dups) do
    warns[#warns + 1] = errors.new(W.DUPLICATE_MEMBER, "manifest member " .. pointer .. " appears more than once; the last one is used",
      { path = "manifest.json", pointer = pointer })
  end
  state.warnings = warns
  state.duplicates = dups
  return state
end

-- Names of descriptive fields a parsed manifest ignores.
function M.ignored_fields(state)
  local out = {}
  for _, w in ipairs(state.warnings or {}) do
    if w.code == W.FIELD_IGNORED then out[#out + 1] = w.field end
  end
  return out
end

-- Current time as an RFC 3339 UTC string.
function M.timestamp(t)
  return os.date("!%Y-%m-%dT%H:%M:%SZ", t or os.time())
end

return M
