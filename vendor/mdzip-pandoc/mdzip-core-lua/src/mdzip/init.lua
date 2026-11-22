-- MDZip core library for Lua: read, write and validate MDZip (.mdz) files.
--
--   local mdzip = require("mdzip")
--   local archive, err = mdzip.open_file("notes.mdz")
--   if not archive then error(tostring(err)) end      -- err.code is e.g. "ERR_ZIP_INVALID"
--   local entry = assert(archive:entry_point())
--   local markdown = assert(archive:read_text(entry))
--
-- Functions that can fail return `nil, err`; err.code is a stable code (the
-- spec's ERR_* names where one applies). See README.md for the full API.
local errors = require("mdzip.errors")
local archive = require("mdzip.archive")
local writer = require("mdzip.writer")
local manifest = require("mdzip.manifest")
local paths = require("mdzip.paths")
local entrypoint = require("mdzip.entrypoint")
local links = require("mdzip.links")
local unicode = require("mdzip.unicode")
local zip = require("mdzip.zip")
local json = require("mdzip.json")

local M = {}
local catch = errors.catch

M.VERSION = require("mdzip.version")
M.SPEC_VERSION = manifest.SPEC_VERSION
M.codes = errors.codes
M.LIMITS = zip.limits
M.REMOVE = writer.REMOVE
M.json = json
M.is_error = errors.is_error

---------------------------------------------------------------------------
-- Host files

local function read_file(path)
  local fh, msg = io.open(path, "rb")
  if not fh then errors.raise(errors.codes.IO, "can't open file: " .. tostring(msg), { path = path }) end
  local data = fh:read("a")
  fh:close()
  if not data then errors.raise(errors.codes.IO, "can't read file", { path = path }) end
  return data
end

local function write_file(path, data)
  local fh, msg = io.open(path, "wb")
  if not fh then errors.raise(errors.codes.IO, "can't create file: " .. tostring(msg), { path = path }) end
  local ok, werr = fh:write(data)
  local closed, cerr = fh:close()
  if not ok or not closed then
    os.remove(path)
    errors.raise(errors.codes.IO, "can't write file: " .. tostring(werr or cerr), { path = path })
  end
end

local function exists(path)
  local fh = io.open(path, "rb")
  if fh then fh:close(); return true end
  return false
end

-- Write `data` to `path` so that a failure never leaves a partial file in
-- place of the original: write a temporary file next to it, then swap.
local function replace_file(path, data)
  local suffix = string.format(".%d%04d.tmp", os.time(), math.random(0, 9999))
  local tmp = path .. suffix
  write_file(tmp, data)
  if not exists(path) then
    local ok, msg = os.rename(tmp, path)
    if not ok then os.remove(tmp); errors.raise(errors.codes.IO, "can't move the new file into place: " .. tostring(msg), { path = path }) end
    return
  end
  local backup = path .. suffix .. ".bak"
  local ok, msg = os.rename(path, backup)
  if not ok then os.remove(tmp); errors.raise(errors.codes.IO, "can't replace the file: " .. tostring(msg), { path = path }) end
  ok, msg = os.rename(tmp, path)
  if not ok then
    os.rename(backup, path)
    os.remove(tmp)
    errors.raise(errors.codes.IO, "can't move the new file into place: " .. tostring(msg), { path = path })
  end
  os.remove(backup)
end

---------------------------------------------------------------------------
-- R1: open

-- open(bytes) -> archive | nil, err
function M.open(data)
  return archive.open(data)
end

-- open_file(path) -> archive | nil, err
function M.open_file(path)
  local data, err = catch(read_file, path)
  if not data then return nil, err end
  return archive.open(data)
end

---------------------------------------------------------------------------
-- R4: validate

-- validate(bytes) -> report { valid, errors, warnings }
function M.validate(data)
  return archive.validate(data)
end

function M.validate_file(path)
  local data, err = catch(read_file, path)
  if not data then return { valid = false, errors = { err }, warnings = {} } end
  return archive.validate(data)
end

---------------------------------------------------------------------------
-- R5: create

-- create(options) -> bytes | nil, err. See writer.create for the options.
function M.create(options)
  return catch(writer.create, options)
end

-- create_file(path, options) -> true | nil, err
function M.create_file(path, options)
  return catch(function()
    replace_file(path, writer.create(options))
    return true
  end)
end

---------------------------------------------------------------------------
-- R6: modify

-- archive:update(changes[, options]) -> bytes, report | nil, err
function archive.Archive:update(changes, options)
  return catch(writer.update, self, changes, options)
end

-- update_file(path, changes[, options]) -> report | nil, err. The file is
-- replaced only after the new archive is complete.
function M.update_file(path, changes, options)
  return catch(function()
    local a, err = archive.open(read_file(path))
    if not a then error(err, 0) end
    local bytes, report = writer.update(a, changes, options)
    replace_file(path, bytes)
    return report
  end)
end

---------------------------------------------------------------------------
-- Building blocks, usable without an archive

-- check_path(path) -> true | nil, err (ERR_PATH_INVALID with err.detail)
function M.check_path(path)
  local err = paths.check_entry_name(path)
  if err then return nil, err end
  return true
end

-- check_entry_names(list) -> true | nil, err (ERR_DUPLICATE_PATH / ERR_PATH_CONFLICT)
function M.check_entry_names(names)
  local err = paths.check_entry_set(names)
  if err then return nil, err end
  return true
end

-- parse_manifest(text) -> state { manifest, errors, warnings }
M.parse_manifest = manifest.parse

-- find_entry_point(file_paths[, manifest_object]) -> path | nil, err
function M.find_entry_point(files, manifest_obj)
  return catch(entrypoint.resolve, entrypoint.index(files), manifest_obj)
end

-- resolve_link(file_paths, from, link) -> result
function M.resolve_link(files, from, link)
  return links.resolve(entrypoint.index(files), from, link)
end

-- same_path(a, b): equal after NFC, case-sensitive (spec 5.4.1).
function M.same_path(a, b)
  return unicode.nfc(a) == unicode.nfc(b)
end

M.nfc = unicode.nfc
M.is_markdown = paths.is_markdown
M.is_support_file = paths.is_support_file

return M
