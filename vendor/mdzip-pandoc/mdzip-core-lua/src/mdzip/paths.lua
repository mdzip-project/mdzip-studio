-- Archive path rules: entry names (spec 5.4), matching (5.4.1), Markdown and
-- support file names (5.5, 7.3).
local unicode = require("mdzip.unicode")
local errors = require("mdzip.errors")

local M = {}
local nfc, ascii_lower = unicode.nfc, unicode.ascii_lower
local C = errors.codes

-- Detail codes for entry name problems (as in the spec's
-- path-validation-cases.json). The error code is always ERR_PATH_INVALID;
-- `detail` says why.
M.details = {
  LEADING_SLASH = "ERR_PATH_LEADING_SLASH",
  TRAVERSAL = "ERR_PATH_TRAVERSAL",
  RESERVED_CHAR = "ERR_PATH_RESERVED_CHAR",
  CONTROL_CHAR = "ERR_PATH_CONTROL_CHAR",
  INVALID = "ERR_PATH_INVALID",
}
local D = M.details

local function problem(path, detail, message)
  return errors.new(C.PATH_INVALID, message, { path = path, detail = detail })
end

-- Check one stored entry name. A name ending in "/" is a directory entry.
-- Returns nil when the name is valid, otherwise an error value.
function M.check_entry_name(name)
  if type(name) ~= "string" or name == "" then
    return problem(tostring(name), D.INVALID, "entry name is empty")
  end
  if not unicode.is_utf8(name) then
    return problem(name, D.INVALID, "entry name is not valid UTF-8")
  end
  if name:sub(1, 1) == "/" then
    return problem(name, D.LEADING_SLASH, "entry name starts with /")
  end
  if name:find("[\0-\31\127]") then
    return problem(name, D.CONTROL_CHAR, "entry name contains a control character")
  end
  if name:find('[\\:%*%?"<>|]') then
    return problem(name, D.RESERVED_CHAR, "entry name contains a reserved character (\\ : * ? \" < > |)")
  end
  local body = name
  if body:sub(-1) == "/" then body = body:sub(1, -2) end -- directory entry
  if body == "" then
    return problem(name, D.INVALID, "entry name has an empty segment")
  end
  local invalid = nil
  for segment in (body .. "/"):gmatch("(.-)/") do
    if segment == ".." then
      return problem(name, D.TRAVERSAL, "entry name contains a .. segment")
    elseif segment == "" or segment == "." then
      invalid = invalid or problem(name, D.INVALID, "entry name has an empty or . segment")
    end
  end
  return invalid
end

function M.is_directory_name(name)
  return name:sub(-1) == "/"
end

-- Markdown file by extension, ASCII case-insensitive (spec 7.3).
function M.is_markdown(path)
  local lower = ascii_lower(path)
  return lower:sub(-3) == ".md" or lower:sub(-9) == ".markdown"
end

local SUPPORT = { readme = true, agents = true, license = true, changelog = true, contributing = true }

-- Root-level README / AGENTS / LICENSE / CHANGELOG / CONTRIBUTING with a
-- Markdown extension, compared ASCII case-insensitively (spec 5.5).
function M.is_support_file(path)
  if path:find("/", 1, true) then return false end
  local lower = ascii_lower(path)
  local stem = lower:match("^(.*)%.md$") or lower:match("^(.*)%.markdown$")
  return stem ~= nil and SUPPORT[stem] == true
end

-- Validate a manifest path such as entryPoint or cover: one leading "./" is
-- allowed and removed (spec 5.5). Returns the path to match, or nil.
function M.normalize_manifest_path(value)
  if type(value) ~= "string" or value == "" then return nil end
  local path = value
  if path:sub(1, 2) == "./" then path = path:sub(3) end
  if path == "" or path:sub(-1) == "/" then return nil end
  if M.check_entry_name(path) then return nil end
  return path
end

-- A valid entry point path (spec 5.5): a valid manifest path to a Markdown file.
function M.normalize_entry_point(value)
  local path = M.normalize_manifest_path(value)
  if path and M.is_markdown(path) then return path end
  return nil
end

-- Check a whole set of stored names: no two equal after NFC
-- (ERR_DUPLICATE_PATH) and no file that is also a directory
-- (ERR_PATH_CONFLICT). Returns nil or an error value.
function M.check_entry_set(names)
  local seen, files, dirs = {}, {}, {}
  for _, name in ipairs(names) do
    local key = nfc(name)
    if seen[key] then
      return errors.new(C.DUPLICATE_PATH, "two entries have the same path after NFC normalization",
        { path = name, other = seen[key] })
    end
    seen[key] = name
    local body = key
    if M.is_directory_name(key) then
      body = key:sub(1, -2)
      dirs[body] = dirs[body] or name
    else
      files[body] = name
    end
    -- Every parent of an entry is a directory.
    local pos = 1
    while true do
      local slash = body:find("/", pos, true)
      if not slash then break end
      local parent = body:sub(1, slash - 1)
      dirs[parent] = dirs[parent] or name
      pos = slash + 1
    end
  end
  for key, name in pairs(files) do
    if dirs[key] then
      return errors.new(C.PATH_CONFLICT, "a file's path is also a directory of another entry",
        { path = name, other = dirs[key] })
    end
  end
  return nil
end

-- Groups of names that differ only in case (spec 5.4 SHOULD NOT): a list of
-- lists, each with two or more names.
function M.case_collisions(names)
  local groups, order = {}, {}
  for _, name in ipairs(names) do
    local key = unicode.case_key(name)
    if not groups[key] then groups[key] = {}; order[#order + 1] = key end
    local g = groups[key]
    g[#g + 1] = name
  end
  local out = {}
  for _, key in ipairs(order) do
    if #groups[key] > 1 then out[#out + 1] = groups[key] end
  end
  return out
end

return M
