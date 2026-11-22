-- CRC-32 (IEEE 802.3, as used by ZIP).
local M = {}

local TABLE = {}
for i = 0, 255 do
  local c = i
  for _ = 1, 8 do
    if c & 1 == 1 then c = 0xEDB88320 ~ (c >> 1) else c = c >> 1 end
  end
  TABLE[i] = c
end

-- crc32(s[, crc]) -> integer. Pass a previous result to continue a stream.
function M.crc32(s, crc)
  local c = (crc or 0) ~ 0xFFFFFFFF
  local byte = string.byte
  local n = #s
  local i = 1
  while i <= n do
    local last = math.min(i + 4095, n)
    local bytes = { byte(s, i, last) }
    for k = 1, #bytes do
      c = TABLE[(c ~ bytes[k]) & 0xFF] ~ (c >> 8)
    end
    i = last + 1
  end
  return c ~ 0xFFFFFFFF
end

return M
