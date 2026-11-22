-- ZIP container reading and writing (APPNOTE 6.3.10), limited to what an
-- .mdz needs: methods 0 and 8, no encryption, central directory governs
-- (spec 4), resource limits (13.1), ZIP64 only when a value needs it.
local errors = require("mdzip.errors")
local inflate = require("mdzip.inflate")
local deflate = require("mdzip.deflate")
local crc32 = require("mdzip.crc32").crc32

local M = {}
local C = errors.codes
local raise = errors.raise
local spack, sunpack, sub, find = string.pack, string.unpack, string.sub, string.find

-- Built-in limits (spec 13.1), no looser than the spec fixtures' reference
-- limits. Exceeding one fails with ERR_LIMIT_EXCEEDED.
M.limits = {
  max_entries = 100000,
  max_entry_bytes = 1024 * 1024 * 1024,           -- 1 GiB uncompressed per entry
  max_total_bytes = 4 * 1024 * 1024 * 1024,       -- 4 GiB uncompressed in all
  max_ratio = 1000,                               -- uncompressed / compressed
  ratio_applies_above = 1024 * 1024,              -- only for entries over 1 MiB
}

local SIG_LOCAL, SIG_CENTRAL = "PK\3\4", "PK\1\2"
local SIG_EOCD, SIG_Z64_LOCATOR, SIG_Z64_EOCD = "PK\5\6", "PK\6\7", "PK\6\6"
local U16, U32 = 0xFFFF, 0xFFFFFFFF

local function invalid(message, path)
  raise(C.ZIP_INVALID, message, path and { path = path } or nil)
end

-- File type from the external attributes of entries made on Unix or macOS.
local S_IFMT, S_IFLNK, S_IFREG, S_IFDIR = 0xF000, 0xA000, 0x8000, 0x4000

local function entry_kind(name, made_by, external)
  local host = made_by >> 8
  local mode = (external >> 16) & 0xFFFF
  if (host == 3 or host == 19) and mode ~= 0 then
    local t = mode & S_IFMT
    if t == S_IFLNK then return "symlink" end
    if t ~= S_IFREG and t ~= S_IFDIR and t ~= 0 then return "special" end
  end
  if name:sub(-1) == "/" then return "directory" end
  return "file"
end

local function find_eocd(data)
  local n = #data
  if n < 22 then invalid("not a ZIP archive (too short)") end
  local floor = math.max(1, n - 22 - 0xFFFF + 1)
  local pos = n - 21
  while pos >= floor do
    if sub(data, pos, pos + 3) == SIG_EOCD then
      local comment_len = sunpack("<I2", data, pos + 20)
      if pos + 21 + comment_len == n then return pos end
    end
    pos = pos - 1
  end
  invalid("not a ZIP archive (no end of central directory record)")
end

-- Parse the central directory. Returns a list of entry records:
-- { name, method, flags, crc, csize, usize, offset, data_start, made_by,
--   external, mtime, mdate, kind, extra_zip64 }
function M.read(data, limits)
  limits = limits or M.limits
  local eocd = find_eocd(data)
  local disk, cd_disk, disk_entries, total_entries, cd_size, cd_offset = sunpack("<I2I2I2I2I4I4", data, eocd + 4)
  local zip64 = false
  if disk == U16 or cd_disk == U16 or disk_entries == U16 or total_entries == U16 or cd_size == U32 or cd_offset == U32 then
    local loc = eocd - 20
    if loc >= 1 and sub(data, loc, loc + 3) == SIG_Z64_LOCATOR then
      local z64_offset = sunpack("<I8", data, loc + 8)
      local p = z64_offset + 1
      if p < 1 or p + 55 > #data or sub(data, p, p + 3) ~= SIG_Z64_EOCD then invalid("bad ZIP64 end of central directory") end
      local d1, d2, e1, e2, size, off = sunpack("<I4I4I8I8I8I8", data, p + 16)
      disk, cd_disk, disk_entries, total_entries, cd_size, cd_offset = d1, d2, e1, e2, size, off
      zip64 = true
    end
  end
  if disk ~= 0 or cd_disk ~= 0 or disk_entries ~= total_entries then invalid("multi-disk archives are not supported") end
  if total_entries > limits.max_entries then
    raise(C.LIMIT_EXCEEDED, "archive has " .. total_entries .. " entries; the limit is " .. limits.max_entries)
  end
  if cd_offset + cd_size > #data then invalid("central directory lies outside the file") end

  local entries = {}
  local p = cd_offset + 1
  local total_bytes = 0
  for i = 1, total_entries do
    if sub(data, p, p + 3) ~= SIG_CENTRAL then invalid("bad central directory entry " .. i) end
    local made_by, _, flags, method, mtime, mdate, crc, csize, usize, nlen, xlen, clen, disk_start, _, external, offset =
      sunpack("<I2I2I2I2I2I2I4I4I4I2I2I2I2I2I4I4", data, p + 4)
    local name = sub(data, p + 46, p + 45 + nlen)
    local extra = sub(data, p + 46 + nlen, p + 45 + nlen + xlen)
    p = p + 46 + nlen + xlen + clen
    if p - 1 > cd_offset + cd_size then invalid("central directory entry runs past its end", name) end
    -- ZIP64 extended information (header 0x0001): only the fields that are 0xFFFFFFFF.
    local used_zip64 = false
    if usize == U32 or csize == U32 or offset == U32 or disk_start == U16 then
      local q = 1
      while q + 3 <= #extra do
        local id, size = sunpack("<I2I2", extra, q)
        if id == 0x0001 then
          local r = q + 4
          if usize == U32 then usize = sunpack("<I8", extra, r); r = r + 8 end
          if csize == U32 then csize = sunpack("<I8", extra, r); r = r + 8 end
          if offset == U32 then offset = sunpack("<I8", extra, r); r = r + 8 end
          used_zip64 = true
          break
        end
        q = q + 4 + size
      end
      if not used_zip64 then invalid("missing ZIP64 extra field", name) end
    end
    if flags & 0x0001 ~= 0 or flags & 0x0040 ~= 0 or method == 99 then
      raise(C.ZIP_ENCRYPTED, "entry is encrypted", { path = name })
    end
    if method ~= 0 and method ~= 8 then
      invalid("entry uses compression method " .. method .. "; only 0 (stored) and 8 (DEFLATE) are supported", name)
    end
    if method == 0 and csize ~= usize then invalid("stored entry's sizes disagree", name) end
    -- Limits on declared sizes, checked before anything is decompressed.
    if usize > limits.max_entry_bytes then
      raise(C.LIMIT_EXCEEDED, "entry declares " .. usize .. " bytes; the limit is " .. limits.max_entry_bytes, { path = name })
    end
    total_bytes = total_bytes + usize
    if total_bytes > limits.max_total_bytes then
      raise(C.LIMIT_EXCEEDED, "archive declares more than " .. limits.max_total_bytes .. " uncompressed bytes", { path = name })
    end
    if usize > limits.ratio_applies_above and usize > csize * limits.max_ratio then
      raise(C.LIMIT_EXCEEDED, "entry's compression ratio is over " .. limits.max_ratio .. ":1", { path = name })
    end
    entries[i] = {
      name = name, method = method, flags = flags, crc = crc, csize = csize, usize = usize,
      offset = offset, made_by = made_by, external = external, mtime = mtime, mdate = mdate,
      kind = entry_kind(name, made_by, external), zip64 = used_zip64,
    }
  end
  if p - 1 ~= cd_offset + cd_size then invalid("central directory size does not match its entries") end

  -- Local headers: each must exist, and entry data must not overlap
  -- (overlapping entries are a ZIP-bomb technique, spec 13.1).
  local by_offset = {}
  for i, e in ipairs(entries) do by_offset[i] = e end
  table.sort(by_offset, function(a, b) return a.offset < b.offset end)
  local next_free = 0
  for _, e in ipairs(by_offset) do
    local lp = e.offset + 1
    if e.offset < next_free then invalid("entry data overlaps another entry", e.name) end
    if lp + 29 > #data or sub(data, lp, lp + 3) ~= SIG_LOCAL then invalid("missing local header", e.name) end
    local lnlen, lxlen = sunpack("<I2I2", data, lp + 26)
    e.data_start = lp + 30 + lnlen + lxlen
    local data_end = e.data_start + e.csize - 1
    if data_end > cd_offset then invalid("entry data runs into the central directory", e.name) end
    next_free = data_end -- 0-based offset of the byte after the data
  end
  return entries, { zip64 = zip64, entry_count = total_entries }
end

-- Decompress one entry, never producing more than it declares.
function M.extract(data, e)
  if e.method == 0 then
    local out = sub(data, e.data_start, e.data_start + e.csize - 1)
    if crc32(out) ~= e.crc then invalid("CRC mismatch", e.name) end
    return out
  end
  local ok, out = pcall(inflate.inflate, data, e.data_start, e.data_start + e.csize - 1, e.usize)
  if not ok then
    if type(out) == "table" and out.inflate == "limit" then
      raise(C.LIMIT_EXCEEDED, "entry decompresses to more than its declared " .. e.usize .. " bytes", { path = e.name })
    elseif type(out) == "table" and out.inflate then
      invalid("corrupt DEFLATE data", e.name)
    end
    error(out, 0)
  end
  if #out ~= e.usize then invalid("entry is shorter than its declared size", e.name) end
  if crc32(out) ~= e.crc then invalid("CRC mismatch", e.name) end
  return out
end

-- Raw compressed bytes of an entry, for copying it unchanged.
function M.raw(data, e)
  return sub(data, e.data_start, e.data_start + e.csize - 1)
end

---------------------------------------------------------------------------
-- Writing

-- File types that are already compressed; storing them is faster and as small.
local STORE_EXT = {
  png = true, jpg = true, jpeg = true, gif = true, webp = true, avif = true, heic = true,
  zip = true, mdz = true, gz = true, bz2 = true, xz = true, ["7z"] = true, rar = true,
  mp3 = true, mp4 = true, m4a = true, mov = true, webm = true, ogg = true, woff = true, woff2 = true,
  pdf = false,
}

function M.dos_time(t)
  local d = os.date("*t", t)
  if d.year < 1980 then d = { year = 1980, month = 1, day = 1, hour = 0, min = 0, sec = 0 } end
  local time = (d.hour << 11) | (d.min << 5) | (d.sec // 2)
  local date = ((d.year - 1980) << 9) | (d.month << 5) | d.day
  return time, date
end

-- Compress content for a new entry: returns method, compressed, crc, size.
function M.pack_content(name, content)
  local crc, size = crc32(content), #content
  local ext = name:match("%.([^./]+)$")
  ext = ext and ext:lower()
  if size > 0 and not STORE_EXT[ext] then
    local z = deflate.deflate(content)
    if #z < size then return 8, z, crc, size end
  end
  return 0, content, crc, size
end

local UNIX_FILE = (0x8000 | 420) << 16   -- regular file, rw-r--r--
local UNIX_DIR = ((0x4000 | 493) << 16) | 0x10 -- directory, rwxr-xr-x, plus the MS-DOS directory bit
local MADE_BY = (3 << 8) | 20            -- Unix, ZIP 2.0

-- Write an archive. Each item is a table:
--   { name, method, compressed, crc, usize, mtime, mdate[, made_by, external] }
-- Directory entries have name ending in "/" and empty content.
-- Returns the archive as a string.
function M.write(items)
  local parts, central = {}, {}
  local offset = 0
  for _, it in ipairs(items) do
    local name = it.name
    local is_dir = name:sub(-1) == "/"
    local flags = name:find("[\128-\255]") and 0x0800 or 0
    local version_needed = it.method == 8 and 20 or (is_dir and 20 or 10)
    local csize, usize = #it.compressed, it.usize
    if csize >= U32 or usize >= U32 then
      raise(C.LIMIT_EXCEEDED, "entries of 4 GiB or more are not supported", { path = name })
    end
    local entry_offset = offset
    local needs_zip64 = entry_offset >= U32
    local localh = spack("<c4I2I2I2I2I2I4I4I4I2I2", SIG_LOCAL, version_needed, flags, it.method,
      it.mtime, it.mdate, it.crc, csize, usize, #name, 0) .. name
    parts[#parts + 1] = localh
    parts[#parts + 1] = it.compressed
    offset = offset + #localh + csize
    local extra = ""
    if needs_zip64 then
      extra = spack("<I2I2I8", 0x0001, 8, entry_offset)
      version_needed = 45
    end
    central[#central + 1] = spack("<c4I2I2I2I2I2I2I4I4I4I2I2I2I2I2I4I4", SIG_CENTRAL,
      it.made_by or MADE_BY, version_needed, flags, it.method, it.mtime, it.mdate, it.crc, csize, usize,
      #name, #extra, 0, 0, 0, it.external or (is_dir and UNIX_DIR or UNIX_FILE),
      needs_zip64 and U32 or entry_offset) .. name .. extra
  end
  local cd = table.concat(central)
  local cd_offset, count = offset, #items
  parts[#parts + 1] = cd
  if count >= U16 or cd_offset >= U32 or #cd >= U32 then
    -- ZIP64 end records, only because a value doesn't fit (spec 4).
    local z64_offset = cd_offset + #cd
    parts[#parts + 1] = spack("<c4I8I2I2I4I4I8I8I8I8", SIG_Z64_EOCD, 44, MADE_BY, 45, 0, 0, count, count, #cd, cd_offset)
    parts[#parts + 1] = spack("<c4I4I8I4", SIG_Z64_LOCATOR, 0, z64_offset, 1)
    parts[#parts + 1] = spack("<c4I2I2I2I2I4I4I2", SIG_EOCD, 0, 0,
      math.min(count, U16), math.min(count, U16), math.min(#cd, U32), math.min(cd_offset, U32), 0)
  else
    parts[#parts + 1] = spack("<c4I2I2I2I2I4I4I2", SIG_EOCD, 0, 0, count, count, #cd, cd_offset, 0)
  end
  return table.concat(parts)
end

return M
