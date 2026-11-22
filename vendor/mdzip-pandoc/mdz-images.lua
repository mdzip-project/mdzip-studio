--[[
mdz-images.lua: a Pandoc Lua filter that publishes an .mdz's pictures as files.

In HTML output, each picture read from the archive is written once to an
images folder, named by its contents (images/3f9a1c2b7e4d.svg), and the page
points to it. That covers Markdown images and <img>/<source> tags in raw HTML,
which Pandoc's --extract-media leaves alone. A picture used by several pages is
stored once, and two different pictures with the same name can't collide.

The tags get data-external="1", so --embed-resources still builds the style
sheet and icon into the page but leaves the pictures as files.

  pandoc -f mdz.lua --lua-filter mdz-images.lua guide.mdz -s -o site/guide.html

writes site/guide.html and site/images/<hash>.<ext>. Two environment variables
change where (the GitHub Action sets both when it converts a folder):

  MDZ_IMAGES_DIR  the folder to write pictures to (default: "images" next to the output file)
  MDZ_IMAGES_URL  how the page refers to that folder (default: "images/")

The cover picture (cover, which mdz.lua takes from the manifest) is published
the same way. When the page has an address (page-url, or site-url for a page
without one), cover-url is set to the picture's full address, for a
template's <meta property="og:image">.
]]

local function dirname(path)
  return path:match("^(.*)[/\\][^/\\]*$") or "."
end

local function setup()
  local dir = os.getenv("MDZ_IMAGES_DIR")
  if not dir or dir == "" then
    local out = PANDOC_STATE.output_file
    if not out then return nil end
    dir = pandoc.path.join({ dirname(out), "images" })
  end
  local url = os.getenv("MDZ_IMAGES_URL")
  if not url or url == "" then url = "images/" end
  if url:sub(-1) ~= "/" then url = url .. "/" end
  return dir, url
end

local dir, url
local written = {}

-- The new address for a picture in the media bag, writing it the first time.
local function publish(src)
  if written[src] then return written[src] end
  local mime, contents = pandoc.mediabag.lookup(src)
  if not contents then return nil end
  local ext = src:match("%.([%w]+)$")
  local name = pandoc.utils.sha1(contents):sub(1, 12) .. (ext and ("." .. ext:lower()) or "")
  local path = pandoc.path.join({ dir, name })
  local existing = io.open(path, "rb")
  if existing then
    existing:close()
  else
    pandoc.system.make_directory(dir, true)
    local f = assert(io.open(path, "wb"))
    f:write(contents)
    f:close()
  end
  written[src] = url .. name
  return written[src]
end

-- Rewrite src (on <img>) and a single-address srcset (on <source>) in raw HTML.
local function rewrite_html(html)
  return (html:gsub("(<[%a]+%f[%s/>][^>]*>)", function(tag)
    local name = tag:match("^<(%a+)"):lower()
    local attr = (name == "img" and "src") or (name == "source" and "srcset") or nil
    if not attr then return nil end
    local changed = false
    local new = tag:gsub("([%s]" .. attr .. "%s*=%s*)([\"'])(.-)%2", function(pre, quote, value)
      local target = publish(value)
      if not target then return nil end
      changed = true
      return pre .. quote .. target .. quote
    end)
    if not changed then return nil end
    if not new:find("data%-external") then
      new = new:gsub("%s*(/?>)$", ' data-external="1"%1')
    end
    return new
  end))
end

-- Resolve an address relative to the page (images/x.png, ../images/x.png)
-- against the page's full address.
local function absolute(rel, base)
  base = base:gsub("[^/]*$", "")
  while rel:sub(1, 3) == "../" do
    rel = rel:sub(4)
    base = base:gsub("[^/]*/$", "")
  end
  return base .. rel
end

local function meta_string(value)
  if value == nil then return nil end
  local s = pandoc.utils.stringify(value)
  return s ~= "" and s or nil
end

local function html_output()
  return FORMAT:match("html") ~= nil
end

return {
  {
    Pandoc = function(doc)
      if not html_output() then return nil end
      dir, url = setup()
      if not dir then
        io.stderr:write("[mdz-images] no output file, so pictures stay as they are\n")
        return nil
      end
      local cover = meta_string(doc.meta.cover)
      local cover_target = cover and publish(cover)
      if cover_target then
        doc.meta.cover = cover_target
        local base = meta_string(doc.meta["page-url"]) or meta_string(doc.meta["site-url"])
        if base and not cover_target:find("^%a[%w+.-]*:") then
          doc.meta["cover-url"] = absolute(cover_target, base)
        end
      end
      return doc:walk({
        Image = function(img)
          local target = publish(img.src)
          if not target then return nil end
          img.src = target
          img.attributes["data-external"] = "1"
          return img
        end,
        RawInline = function(raw)
          if raw.format == "html" then raw.text = rewrite_html(raw.text); return raw end
        end,
        RawBlock = function(raw)
          if raw.format == "html" then raw.text = rewrite_html(raw.text); return raw end
        end,
      })
    end,
  },
}
