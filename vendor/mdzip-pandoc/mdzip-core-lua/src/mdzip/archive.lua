-- An opened .mdz archive: inspection, reading, entry point, links, validation.
local zip = require("mdzip.zip")
local errors = require("mdzip.errors")
local unicode = require("mdzip.unicode")
local paths = require("mdzip.paths")
local manifest = require("mdzip.manifest")
local entrypoint = require("mdzip.entrypoint")
local links = require("mdzip.links")

local M = {}
local C = errors.codes
local catch = errors.catch

-- Warning codes for archive-level findings (not spec codes).
M.warnings = {
  SPECIAL_ENTRY = "WARN_SPECIAL_ENTRY",       -- symbolic link or other special file: skipped, never followed (spec 13.1)
  CASE_COLLISION = "WARN_CASE_COLLISION",     -- names that differ only in case (spec 5.4 SHOULD NOT)
  COVER_MISSING = "WARN_COVER_MISSING",       -- manifest cover names no file in the archive (spec 6.2)
  ZIP64_UNNEEDED = "WARN_ZIP64_UNNEEDED",     -- ZIP64 records where no value needed them (spec 4 MUST NOT)
  UTF8_FLAG_MISSING = "WARN_UTF8_FLAG_MISSING", -- non-ASCII name without general purpose bit 11 (spec 4 MUST)
}
local W = M.warnings

local Archive = {}
Archive.__index = Archive
M.Archive = Archive

local function open(data, limits)
  if type(data) ~= "string" then errors.raise(C.ARGUMENT, "open() takes the archive's bytes as a string") end
  local records, info = zip.read(data, limits)
  local names = {}
  for i, e in ipairs(records) do
    local err = paths.check_entry_name(e.name)
    if err then error(err, 0) end
    names[i] = e.name
  end
  local err = paths.check_entry_set(names)
  if err then error(err, 0) end

  local self = setmetatable({
    data = data, records = records, info = info,
    _files = {}, _dirs = {}, _specials = {}, by_name = {},
  }, Archive)
  for _, e in ipairs(records) do
    self.by_name[e.name] = e
    if e.kind == "file" then self._files[#self._files + 1] = e.name
    elseif e.kind == "directory" then self._dirs[#self._dirs + 1] = e.name
    else self._specials[#self._specials + 1] = e.name end
  end
  self.idx = entrypoint.index(self._files)
  local mrec = self.by_name["manifest.json"]
  if mrec and mrec.kind == "file" then
    self.manifest_record = mrec
    self.manifest_state = manifest.parse(zip.extract(data, mrec))
  else
    self.manifest_state = { errors = {}, warnings = {} }
  end
  return self
end

-- open(bytes[, limits]) -> archive | nil, err
function M.open(data, limits)
  return catch(open, data, limits)
end

---------------------------------------------------------------------------
-- R2: inspect entries and metadata

-- All entries in archive order: { path, kind = "file" | "directory" |
-- "symlink" | "special", size, compressed_size, method }.
function Archive:entries()
  local out = {}
  for i, e in ipairs(self.records) do
    out[i] = { path = e.name, kind = e.kind, size = e.usize, compressed_size = e.csize, method = e.method }
  end
  return out
end

-- Stored names of regular files, in archive order. Symbolic links and other
-- special entries are not files (see special_entries).
function Archive:files()
  return { table.unpack(self._files) }
end

-- Stored names of directory entries (ending in "/"), in archive order.
function Archive:directories()
  return { table.unpack(self._dirs) }
end

-- Markdown files (.md / .markdown, ASCII case-insensitive), in archive order.
function Archive:documents()
  local out = {}
  for _, name in ipairs(self._files) do
    if paths.is_markdown(name) then out[#out + 1] = name end
  end
  return out
end

-- Symbolic links and other special entries, which are skipped: { path, kind }.
function Archive:special_entries()
  local out = {}
  for _, name in ipairs(self._specials) do out[#out + 1] = { path = name, kind = self.by_name[name].kind } end
  return out
end

-- The stored name of the file matching `path` (NFC, case-sensitive), or nil.
function Archive:find(path)
  return entrypoint.find(self.idx, path)
end

function Archive:has(path)
  return self:find(path) ~= nil
end

-- A file whose name equals `path` only when case is ignored, or nil. For
-- "did you mean" hints; it is never a match (spec 5.4.1).
function Archive:near_match(path)
  local m = entrypoint.near_match(self.idx, path)
  if m and m ~= self:find(path) then return m end
  return nil
end

-- read(path) -> bytes | nil, err (ERR_NOT_FOUND, ERR_ZIP_INVALID, ERR_LIMIT_EXCEEDED)
function Archive:read(path)
  local name = self:find(path)
  if not name then
    local near = self:near_match(path)
    return nil, errors.new(C.NOT_FOUND, "no file with this path" .. (near and (" (did you mean " .. near .. "?)") or ""),
      { path = tostring(path), suggestion = near })
  end
  return catch(zip.extract, self.data, self.by_name[name])
end

-- read_text(path) -> UTF-8 string | nil, err. Line endings are left as stored.
function Archive:read_text(path)
  local bytes, err = self:read(path)
  if not bytes then return nil, err end
  if not unicode.is_utf8(bytes) then
    return nil, errors.new(C.TEXT_INVALID, "file is not valid UTF-8", { path = self:find(path) })
  end
  return bytes
end

-- The decoded manifest (a json object), nil when there is none, or
-- nil, ERR_MANIFEST_INVALID when manifest.json can't be read as a JSON object.
-- Field values are as stored; validate() reports wrong ones.
function Archive:manifest()
  local s = self.manifest_state
  if self.manifest_record and not s.manifest then return nil, s.errors[1] end
  return s.manifest
end

function Archive:has_manifest()
  return self.manifest_record ~= nil
end

-- Errors that make the manifest unusable for interpretation.
local function blocking_error(self)
  for _, e in ipairs(self.manifest_state.errors) do
    if e.code == C.MANIFEST_INVALID or e.code == C.VERSION_UNSUPPORTED then return e end
  end
  return nil
end

-- spec.version as declared, or nil.
function Archive:spec_version()
  local m = self.manifest_state.manifest
  local spec = m and m.spec
  if type(spec) == "table" and type(spec.version) == "string" then return spec.version end
  return nil
end

-- entry_point() -> stored name | nil, err (ERR_ENTRYPOINT_INVALID,
-- ERR_ENTRYPOINT_MISSING, ERR_ENTRYPOINT_UNRESOLVED, or ERR_MANIFEST_INVALID /
-- ERR_VERSION_UNSUPPORTED when the manifest can't be used).
function Archive:entry_point()
  local blocked = blocking_error(self)
  if blocked then return nil, blocked end
  return catch(entrypoint.resolve, self.idx, self.manifest_state.manifest)
end

-- mode() -> "document" | "project" | nil, err (ERR_MODE_UNSUPPORTED for a
-- mode this library doesn't recognize; never a silent fallback).
function Archive:mode()
  local blocked = blocking_error(self)
  if blocked then return nil, blocked end
  for _, e in ipairs(self.manifest_state.errors) do
    if e.code == C.MODE_UNSUPPORTED then return nil, e end
  end
  local m = self.manifest_state.manifest
  return (m and m.mode) or "document"
end

-- title() -> the manifest title when it's valid, else nil.
function Archive:title()
  local m = self.manifest_state.manifest
  if m and type(m.title) == "string" and m.title ~= "" then return m.title end
  return nil
end

---------------------------------------------------------------------------
-- R3: links

-- resolve_link(from, link[, options]) -> result table; see mdzip.links.
-- `from` is the referencing document's path in the archive.
function Archive:resolve_link(from, link, options)
  local source = self:find(from) or from
  return links.resolve(self.idx, source, link, options)
end

---------------------------------------------------------------------------
-- R4: validation

local function has_code(list, code)
  for _, e in ipairs(list) do if e.code == code then return true end end
  return false
end

-- validate() -> report { valid = bool, errors = {...}, warnings = {...} }.
-- Each finding is an error value with `code`, `message` and usually `path`.
function Archive:validate()
  local errs, warns = {}, {}
  for _, e in ipairs(self.manifest_state.errors) do errs[#errs + 1] = e end
  for _, w in ipairs(self.manifest_state.warnings) do warns[#warns + 1] = w end
  local ep, ep_err = self:entry_point()
  if not ep and not has_code(errs, ep_err.code) then errs[#errs + 1] = ep_err end
  -- No manifest is not a finding: the archive is valid (spec 6, T-007).
  local m = self.manifest_state.manifest
  local cover = m and paths.normalize_manifest_path(m.cover)
  if cover and not self:find(cover) then
    warns[#warns + 1] = errors.new(W.COVER_MISSING, "manifest cover names a file that is not in the archive; ignored", { path = cover })
  end
  for _, name in ipairs(self._specials) do
    warns[#warns + 1] = errors.new(W.SPECIAL_ENTRY, "entry is a " .. self.by_name[name].kind
      .. "; it is skipped and never followed", { path = name })
  end
  local names = {}
  for _, e in ipairs(self.records) do names[#names + 1] = e.name end
  for _, group in ipairs(paths.case_collisions(names)) do
    warns[#warns + 1] = errors.new(W.CASE_COLLISION, "entries differ only in case: " .. table.concat(group, ", ")
      .. "; they collide when extracted on Windows or macOS", { path = group[1], names = group })
  end
  local needs_zip64 = #self.records >= 0xFFFF or #self.data >= 0xFFFFFFFF
  if self.info.zip64 and not needs_zip64 then
    warns[#warns + 1] = errors.new(W.ZIP64_UNNEEDED, "archive uses ZIP64 end records although no value needs them")
  end
  for _, e in ipairs(self.records) do
    if e.zip64 and e.usize < 0xFFFFFFFF and e.csize < 0xFFFFFFFF and e.offset < 0xFFFFFFFF then
      warns[#warns + 1] = errors.new(W.ZIP64_UNNEEDED, "entry uses a ZIP64 extra field although no value needs it", { path = e.name })
    end
    if e.flags & 0x0800 == 0 and not unicode.is_ascii(e.name) then
      warns[#warns + 1] = errors.new(W.UTF8_FLAG_MISSING, "non-ASCII entry name without the UTF-8 flag (bit 11)", { path = e.name })
    end
  end
  return { valid = #errs == 0, errors = errs, warnings = warns }
end

-- Validate archive bytes: like open():validate(), but a failure to open is
-- reported as a finding instead of returned as an error.
function M.validate(data, limits)
  local archive, err = M.open(data, limits)
  if not archive then return { valid = false, errors = { err }, warnings = {} } end
  return archive:validate()
end

return M
