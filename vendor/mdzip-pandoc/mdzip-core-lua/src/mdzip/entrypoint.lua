-- Entry point discovery (spec 5.5) and path lookup (5.4.1).
local errors = require("mdzip.errors")
local unicode = require("mdzip.unicode")
local paths = require("mdzip.paths")

local M = {}
local C = errors.codes
local nfc = unicode.nfc

-- An index for exact lookups: NFC-normalized path -> stored name.
-- `files` is a list of stored names of regular files.
function M.index(files)
  local idx = { by_key = {}, by_case = {}, list = files }
  for _, name in ipairs(files) do
    idx.by_key[nfc(name)] = name
    local ck = unicode.case_key(name)
    idx.by_case[ck] = idx.by_case[ck] or name
  end
  return idx
end

-- The stored name matching `path` (NFC, case-sensitive), or nil.
function M.find(idx, path)
  if type(path) ~= "string" or not unicode.is_utf8(path) then return nil end
  return idx.by_key[nfc(path)]
end

-- A stored name equal to `path` only under case folding, or nil
-- (for "did you mean" messages; never used as a match, spec 5.4.1).
function M.near_match(idx, path)
  if type(path) ~= "string" or not unicode.is_utf8(path) then return nil end
  return idx.by_case[unicode.case_key(path)]
end

-- Resolve the entry point. `manifest` is the decoded manifest object or nil.
-- Returns the stored name; raises ERR_ENTRYPOINT_INVALID,
-- ERR_ENTRYPOINT_MISSING or ERR_ENTRYPOINT_UNRESOLVED. Never falls back from
-- a declared entryPoint to rules 2-4.
function M.resolve(idx, manifest)
  local declared = manifest and manifest.entryPoint
  if declared ~= nil then
    local path = paths.normalize_entry_point(declared)
    if not path then
      errors.raise(C.ENTRYPOINT_INVALID, "manifest entryPoint is not a valid entry point path",
        { path = type(declared) == "string" and declared or nil })
    end
    local found = M.find(idx, path)
    if found then return found end
    local near = M.near_match(idx, path)
    errors.raise(C.ENTRYPOINT_MISSING,
      "manifest entryPoint names a file that is not in the archive" .. (near and (" (did you mean " .. near .. "?)") or ""),
      { path = path, suggestion = near })
  end
  local index = M.find(idx, "index.md")
  if index then return index end
  local content, all = {}, {}
  for _, name in ipairs(idx.list) do
    if not name:find("/", 1, true) and paths.is_markdown(name) then
      all[#all + 1] = name
      if not paths.is_support_file(name) then content[#content + 1] = name end
    end
  end
  if #content == 1 then return content[1] end
  if #content == 0 and #all == 1 then return all[1] end
  local candidates = #content > 0 and content or all
  errors.raise(C.ENTRYPOINT_UNRESOLVED,
    #all == 0 and "the archive has no Markdown file at its root"
      or "no unambiguous entry point: " .. table.concat(candidates, ", "),
    { candidates = candidates })
end

return M
