-- Creating archives (R5) and modifying them (R6).
local zip = require("mdzip.zip")
local json = require("mdzip.json")
local errors = require("mdzip.errors")
local unicode = require("mdzip.unicode")
local paths = require("mdzip.paths")
local manifest = require("mdzip.manifest")
local entrypoint = require("mdzip.entrypoint")
local version = require("mdzip.version")

local M = {}
local C = errors.codes
local raise = errors.raise
local nfc = unicode.nfc

-- Pass as a manifest value in update() to remove that field.
M.REMOVE = setmetatable({}, { __tostring = function() return "mdzip.REMOVE" end })

M.warnings = {
  SPECIAL_ENTRY_KEPT = "WARN_SPECIAL_ENTRY_KEPT",       -- a symbolic link or special file was kept as it was
  STILL_NONCONFORMING = "WARN_STILL_NONCONFORMING",     -- a problem that was already there is still there
  ENTRY_POINT_UNRESOLVED = "WARN_ENTRY_POINT_UNRESOLVED", -- the archive had no resolvable entry point before either
}
local W = M.warnings

local CORE = { name = "mdzip-core-lua", version = version, url = "https://github.com/mdzip-project/mdzip-core-lua" }

-- Convert plain Lua values to JSON values: sequences become arrays, other
-- tables objects (keys sorted). json objects/arrays are deep-copied.
local function to_json(v)
  if v == M.REMOVE then return v end
  if type(v) ~= "table" or v == json.null then return v end
  if json.is_object(v) or json.is_array(v) then return json.copy(v) end
  local n, count = #v, 0
  for _ in pairs(v) do count = count + 1 end
  if count > 0 and n == count then
    local a = json.array()
    for i = 1, n do a[i] = to_json(v[i]) end
    return a
  end
  local keys = {}
  for k in pairs(v) do
    if type(k) ~= "string" then raise(C.ARGUMENT, "manifest object keys must be strings") end
    keys[#keys + 1] = k
  end
  table.sort(keys)
  local o = json.object()
  for _, k in ipairs(keys) do json.set(o, k, to_json(v[k])) end
  return o
end
M.to_json = to_json

-- Content for a file being written: { path, data = bytes } or { path, text = string }.
local function file_content(name, item)
  local content = item.data
  if content == nil then content = item.text end
  if type(content) ~= "string" then
    raise(C.ARGUMENT, "each file needs `data` (bytes) or `text` (string)", { path = name })
  end
  if paths.is_markdown(name) then
    if not unicode.is_utf8(content) then raise(C.TEXT_INVALID, "Markdown files must be UTF-8", { path = name }) end
    content = content:gsub("\r\n", "\n") -- LF in Markdown files (spec 12.2)
  elseif item.text ~= nil and not unicode.is_utf8(content) then
    raise(C.TEXT_INVALID, "text is not valid UTF-8", { path = name })
  end
  return content
end

-- Validate a caller-supplied file path; returns its NFC form.
local function file_name(path)
  if type(path) ~= "string" then raise(C.ARGUMENT, "file path must be a string") end
  if path:sub(-1) == "/" then raise(C.ARGUMENT, "file path ends in /; directories are created implicitly", { path = path }) end
  local err = paths.check_entry_name(path)
  if err then error(err, 0) end
  local name = nfc(path)
  if name == "manifest.json" then
    raise(C.ARGUMENT, "manifest.json is written by the library; pass manifest fields instead", { path = path })
  end
  return name
end

local function new_item(name, content, mtime, mdate)
  local method, compressed, crc, size = zip.pack_content(name, content)
  return { name = name, method = method, compressed = compressed, crc = crc, usize = size, mtime = mtime, mdate = mdate }
end

local function copy_item(data, rec)
  return {
    name = rec.name, method = rec.method, compressed = zip.raw(data, rec), crc = rec.crc, usize = rec.usize,
    mtime = rec.mtime, mdate = rec.mdate, made_by = rec.made_by, external = rec.external,
  }
end

local function merge_producer(obj, application)
  local producer = obj.producer
  if not json.is_object(producer) then producer = json.object(); json.set(obj, "producer", producer) end
  if application then
    local app = producer.application
    if not json.is_object(app) then app = json.object(); json.set(producer, "application", app) end
    for _, k in ipairs({ "name", "version", "url" }) do
      if application[k] ~= nil then json.set(app, k, application[k]) end
    end
  end
  return producer
end

local function set_core(obj)
  local producer = merge_producer(obj, nil)
  json.set(producer, "core", to_json(CORE))
end

-- Check a manifest we are about to write. A problem raises, unless `before`
-- (a parsed manifest state of the archive being modified) already had it:
-- then it is returned as a warning, since keeping an existing problem is
-- allowed when the caller is told (spec 14.1).
local function check_written_manifest(obj, idx, before)
  local had = {}
  for _, e in ipairs(before and before.errors or {}) do had[e.code .. ":" .. tostring(e.field)] = true end
  for _, w in ipairs(before and before.warnings or {}) do had[w.code .. ":" .. tostring(w.field)] = true end
  local kept = {}
  local function problem(key_code, raise_code, message, field)
    if had[key_code .. ":" .. tostring(field)] then
      kept[#kept + 1] = errors.new(W.STILL_NONCONFORMING, message .. " (already the case before this change)",
        { path = "manifest.json", field = field })
    else
      raise(raise_code, message, { path = "manifest.json", field = field })
    end
  end
  local errs, warns = manifest.check(obj)
  for _, e in ipairs(errs) do problem(e.code, e.code, e.message, e.field) end
  for _, w in ipairs(warns) do
    if w.code == manifest.warnings.FIELD_IGNORED then
      problem(w.code, C.MANIFEST_INVALID, "manifest " .. w.field .. " has a wrong type or value", w.field)
    end
  end
  local cover = obj.cover and paths.normalize_manifest_path(obj.cover)
  if cover and not entrypoint.find(idx, cover) then
    local was_missing = before and before.cover_missing == cover
    if was_missing then
      kept[#kept + 1] = errors.new(W.STILL_NONCONFORMING, "manifest cover names a file that is not in the archive (already the case before this change)",
        { path = cover, field = "cover" })
    else
      raise(C.MANIFEST_INVALID, "manifest cover names a file that is not in the archive", { path = cover, field = "cover" })
    end
  end
  return kept
end

---------------------------------------------------------------------------
-- R5: create

-- create(options) -> bytes. Options:
--   files        list of { path = "index.md", text = "..." } or { path = ..., data = bytes }
--   entry_point  path of the entry point (default: index.md, or the only root Markdown file)
--   title        document title
--   mode         "document" (default) or "project"
--   application  { name, version, url } of the app creating the archive
--   manifest     other manifest fields (author, language, cover, x-... and so on)
--   time         creation time (os.time() value; default now)
function M.create(options)
  if type(options) ~= "table" or type(options.files) ~= "table" then
    raise(C.ARGUMENT, "create() needs { files = { ... } }")
  end
  local time = options.time or os.time()
  local mtime, mdate = zip.dos_time(time)
  local names, contents = {}, {}
  for i, item in ipairs(options.files) do
    if type(item) ~= "table" then raise(C.ARGUMENT, "files[" .. i .. "] is not a table") end
    local name = file_name(item.path)
    names[i] = name
    contents[i] = file_content(name, item)
  end
  local all = { table.unpack(names) }
  all[#all + 1] = "manifest.json"
  local set_err = paths.check_entry_set(all)
  if set_err then error(set_err, 0) end
  local idx = entrypoint.index(names)

  local ep
  if options.entry_point ~= nil then
    local wanted = paths.normalize_entry_point(options.entry_point)
    if not wanted then raise(C.ENTRYPOINT_INVALID, "entry_point is not a valid entry point path", { path = tostring(options.entry_point) }) end
    ep = entrypoint.find(idx, wanted)
    if not ep then raise(C.ENTRYPOINT_MISSING, "entry_point names a file that is not in files", { path = wanted }) end
  else
    ep = entrypoint.resolve(idx, nil)
  end
  local mode = options.mode or "document"
  if not manifest.MODES[mode] then raise(C.MODE_UNSUPPORTED, "mode must be \"document\" or \"project\"", { mode = tostring(mode) }) end

  local obj = json.object()
  json.set(obj, "spec", to_json({ name = manifest.SPEC_NAME, version = manifest.SPEC_VERSION }))
  merge_producer(obj, options.application)
  set_core(obj)
  if options.title ~= nil then json.set(obj, "title", options.title) end
  json.set(obj, "mode", mode)
  json.set(obj, "entryPoint", ep)
  json.set(obj, "created", to_json({ when = manifest.timestamp(time) }))
  if options.manifest ~= nil then
    if type(options.manifest) ~= "table" then raise(C.ARGUMENT, "manifest must be a table of fields") end
    local extra = to_json(options.manifest)
    for _, k in ipairs(json.keys(extra)) do
      if k == "spec" or k == "entryPoint" or k == "mode" then
        raise(C.ARGUMENT, "set " .. k .. " with create()'s own options, not in manifest", { field = k })
      elseif k == "producer" and json.is_object(extra.producer) then
        for _, pk in ipairs(json.keys(extra.producer)) do
          if pk ~= "core" then json.set(obj.producer, pk, extra.producer[pk]) end
        end
      else
        json.set(obj, k, extra[k])
      end
    end
  end
  check_written_manifest(obj, idx)

  local items = { new_item("manifest.json", json.encode(obj), mtime, mdate) }
  for i, name in ipairs(names) do items[#items + 1] = new_item(name, contents[i], mtime, mdate) end
  return zip.write(items)
end

---------------------------------------------------------------------------
-- R6: update

-- update(archive, changes[, options]) -> bytes, report.
-- changes:
--   put          list of { path, text | data }: add a file, or replace the one with that path
--   remove       list of paths to remove (files, directory entries or special entries)
--   manifest     { field = value, ... } to set; mdzip.REMOVE removes a field
--   entry_point  a new entry point (only when changing it is the point)
-- options:
--   application  { name, version, url }: recorded as producer.application
--   touch        false to leave `modified` alone (default: set modified.when)
--   time         the modification time (default now)
-- Everything not named in changes keeps its path and bytes; unknown manifest
-- fields are kept. Fails without producing anything if the result would
-- change or break the entry point.
function M.update(archive, changes, options)
  changes = changes or {}
  options = options or {}
  local time = options.time or os.time()
  local mtime, mdate = zip.dos_time(time)
  local data = archive.data
  local report = { warnings = {} }
  local function warn(code, message, fields) report.warnings[#report.warnings + 1] = errors.new(code, message, fields) end

  local state = archive.manifest_state
  for _, e in ipairs(state.errors) do
    if e.code == C.VERSION_UNSUPPORTED then error(e, 0) end
  end
  local prev_ep = archive:entry_point()

  -- Slots in archive order; each holds an existing record or new content.
  local slots, by_key = {}, {}
  local manifest_slot
  for _, rec in ipairs(archive.records) do
    local slot = { name = rec.name, record = rec }
    slots[#slots + 1] = slot
    if rec == archive.manifest_record then manifest_slot = slot
    else by_key[nfc(rec.name)] = slot end
  end

  for _, path in ipairs(changes.remove or {}) do
    if type(path) ~= "string" then raise(C.ARGUMENT, "remove takes a list of paths") end
    if nfc(path) == "manifest.json" then raise(C.ARGUMENT, "manifest.json can't be removed", { path = path }) end
    local slot = by_key[nfc(path)]
    if not slot or slot.removed then raise(C.NOT_FOUND, "no entry with this path to remove", { path = path }) end
    slot.removed = true
  end
  for _, item in ipairs(changes.put or {}) do
    if type(item) ~= "table" then raise(C.ARGUMENT, "put takes a list of { path, text | data }") end
    local name = file_name(item.path)
    local content = file_content(name, item)
    local slot = by_key[name]
    if slot and not slot.removed and slot.record.kind ~= "directory" then
      slot.content, slot.record = content, nil -- replaced; keeps its stored name and place
    else
      slot = { name = name, content = content }
      slots[#slots + 1] = slot
      by_key[name] = slot
    end
  end

  -- The manifest.
  local wants_manifest_change = changes.manifest ~= nil or changes.entry_point ~= nil or options.application ~= nil
  local obj, rewrite = nil, false
  if archive.manifest_record and not state.manifest then
    if wants_manifest_change then
      raise(C.MANIFEST_INVALID, "manifest.json can't be read, so it can't be changed", { path = "manifest.json" })
    end
    warn(W.STILL_NONCONFORMING, "manifest.json can't be read; it was kept as it was", { path = "manifest.json" })
  elseif state.manifest then
    obj = json.copy(state.manifest)
    rewrite = wants_manifest_change or options.touch ~= false
  elseif prev_ep or changes.entry_point ~= nil then
    -- No manifest: add one, recording the entry point the archive had (spec 14.1).
    obj = json.object()
    json.set(obj, "spec", to_json({ name = manifest.SPEC_NAME }))
    set_core(obj)
    if prev_ep then json.set(obj, "entryPoint", prev_ep) end
    rewrite = true
  end
  if rewrite then
    if obj.spec == nil then json.set(obj, "spec", to_json({ name = manifest.SPEC_NAME })) end
    if json.is_object(obj.spec) and obj.spec.version == nil then json.set(obj.spec, "version", manifest.SPEC_VERSION) end
    if changes.manifest ~= nil then
      if type(changes.manifest) ~= "table" then raise(C.ARGUMENT, "manifest changes must be a table of fields") end
      local keys = {}
      for k in pairs(changes.manifest) do keys[#keys + 1] = k end
      table.sort(keys)
      for _, k in ipairs(keys) do
        local v = changes.manifest[k]
        if k == "entryPoint" then raise(C.ARGUMENT, "change the entry point with entry_point, not manifest") end
        if v == M.REMOVE then obj[k] = nil else json.set(obj, k, to_json(v)) end
      end
    end
    if changes.entry_point ~= nil then json.set(obj, "entryPoint", changes.entry_point) end
    if options.application then merge_producer(obj, options.application) end
    if options.touch ~= false then
      local when = manifest.timestamp(time)
      if type(obj.modified) == "string" then json.set(obj, "modified", when) -- keep the legacy form
      elseif json.is_object(obj.modified) then json.set(obj.modified, "when", when)
      else json.set(obj, "modified", to_json({ when = when })) end
    end
  end

  -- The result's entries.
  local names, files = {}, {}
  for _, slot in ipairs(slots) do
    if not slot.removed and slot ~= manifest_slot then
      names[#names + 1] = slot.name
      if slot.content or slot.record.kind == "file" then files[#files + 1] = slot.name end
      if slot.record and (slot.record.kind == "symlink" or slot.record.kind == "special") then
        warn(W.SPECIAL_ENTRY_KEPT, "kept a " .. slot.record.kind .. " entry as it was; remove it to make the archive conforming",
          { path = slot.name })
      end
    end
  end
  if manifest_slot or obj then names[#names + 1] = "manifest.json" end
  local set_err = paths.check_entry_set(names)
  if set_err then error(set_err, 0) end

  -- The entry point must stay where it was unless changing it is the point.
  local idx = entrypoint.index(files)
  local effective = obj or (state.manifest) -- an unreadable manifest is kept raw: entry point stays unresolvable
  if archive.manifest_record and not state.manifest then effective = nil end
  local new_ep, ep_err = errors.catch(entrypoint.resolve, idx, effective)
  if archive.manifest_record and not state.manifest then new_ep, ep_err = nil, state.errors[1] end
  if changes.entry_point ~= nil then
    if not new_ep then error(ep_err, 0) end
  elseif prev_ep then
    if not new_ep then
      raise(ep_err.code, "this change would leave the entry point unresolvable: " .. ep_err.message, { path = prev_ep })
    elseif nfc(new_ep) ~= nfc(prev_ep) then
      raise(C.ENTRYPOINT_MISSING, "this change would move the entry point from " .. prev_ep .. " to " .. new_ep
        .. "; pass entry_point to change it", { path = prev_ep })
    end
  elseif not new_ep then
    warn(W.ENTRY_POINT_UNRESOLVED, "the archive had no resolvable entry point before this change and still has none")
  end
  if obj and rewrite then
    local before = { errors = state.errors, warnings = state.warnings }
    local old_cover = state.manifest and paths.normalize_manifest_path(state.manifest.cover)
    if old_cover and not archive:find(old_cover) then before.cover_missing = old_cover end
    for _, w in ipairs(check_written_manifest(obj, idx, before)) do report.warnings[#report.warnings + 1] = w end
  end

  -- Write.
  local items = {}
  local manifest_item
  if obj and rewrite then manifest_item = new_item("manifest.json", json.encode(obj), mtime, mdate)
  elseif manifest_slot then manifest_item = copy_item(data, manifest_slot.record) end
  if manifest_item and not manifest_slot then items[1] = manifest_item end
  for _, slot in ipairs(slots) do
    if slot == manifest_slot then
      items[#items + 1] = manifest_item
    elseif not slot.removed then
      if slot.content then items[#items + 1] = new_item(slot.name, slot.content, mtime, mdate)
      else items[#items + 1] = copy_item(data, slot.record) end
    end
  end
  return zip.write(items), report
end

return M
