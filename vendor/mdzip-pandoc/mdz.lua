--[[
mdz.lua: a Pandoc custom reader and writer for MDZip (.mdz) files.

  pandoc -f mdz.lua guide.mdz -o guide.docx      read an .mdz
  pandoc notes.md -t mdz.lua -o notes.mdz         write an .mdz

Reading converts the archive's entry point (spec 5.5), or the document named
by the MDZ_DOCUMENT environment variable (its path in the archive, such as
chapters/install.md). Its images come from inside the archive and go into
Pandoc's media bag, so Word, EPUB and HTML output (with --embed-resources)
include them. Writing packages the document as index.md plus every image it
uses, under images/.

Switches (add to the format, as in -f mdz.lua+gfm):
  gfm            read or write GitHub-Flavored Markdown (writing uses it by default)
  commonmark     read or write CommonMark with Pandoc's extensions, commonmark_x
                 (reading uses it by default: it reads Markdown the way MDZip
                 editors do)
  pandoc         read or write Pandoc's Markdown
  raw_html       keep raw HTML from the archive (on by default; -raw_html drops it)
  combine        read the entry point and the documents it links to, as one
                 document; in a project-mode archive, every document, each
                 kept as a part of its own (a collection, spec 5.7.3)
  orphans        with combine, add the documents nothing links to as well
                 (a project's collection always has them)
  pagebreaks     with combine, start each document on a new page

Writing gives plain Markdown. Turn any of these on to keep, as HTML, what
Markdown can't write, so the .mdz looks more like the original
(-t mdz.lua+image_sizes+html_tables+table_look+html_formatting for all four):
  image_sizes      pictures at the size the document shows them (from Word,
                   older VML pictures too); off: plain Markdown images
  html_tables      tables with merged cells, or headings, lists or several
                   paragraphs in a cell; off: made into Markdown tables, each
                   cell one line and merged cells split
  table_look       from Word: shaded cells, and tables whose lines or table
                   style differ from most of the document's (docx.lua puts them
                   back); such a table is written as HTML; off: nothing kept
  html_formatting  underline, superscript, subscript, small caps, highlight;
                   off: plain text

And, not part of the document:
  notes            sources/conversion-notes.md: the original's name, size and
                   SHA-1, when and with what it was converted, and, from Word,
                   what didn't come across (comments, tracked changes, shapes,
                   text boxes, fields, charts, headers and footers...)

Needs mdzip-core-lua (https://github.com/mdzip-project/mdzip-core-lua): set
MDZIP_LUA_PATH to its src folder, or keep it next to this file.
]]

local VERSION = "0.8.0"
local URL = "https://github.com/mdzip-project/mdzip-pandoc"

Extensions = {
  gfm = false,
  commonmark = false,
  pandoc = false,
  raw_html = true,
  combine = false,
  orphans = false,
  pagebreaks = false,
  -- Writing: what Markdown can't write, kept as HTML (each off by default).
  image_sizes = false,
  html_tables = false,
  table_look = false,
  html_formatting = false,
  -- Writing: sources/conversion-notes.md (off by default).
  notes = false,
}

---------------------------------------------------------------------------
-- Finding the core library

local script_dir = (PANDOC_SCRIPT_FILE or ""):match("^(.*)[/\\]") or "."
local search = { script_dir .. "/../mdzip-core-lua/src", script_dir .. "/mdzip-core-lua/src" }
local env_dir = os.getenv("MDZIP_LUA_PATH")
if env_dir and env_dir ~= "" then search[#search + 1] = env_dir end -- added last, so searched first
for _, dir in ipairs(search) do
  package.path = dir .. "/?.lua;" .. dir .. "/?/init.lua;" .. package.path
end
local found, mdzip = pcall(require, "mdzip")
if not found then
  error("mdz.lua needs the mdzip-core-lua library. Set MDZIP_LUA_PATH to its src folder, "
    .. "or put a mdzip-core-lua folder next to mdz.lua.\n" .. tostring(mdzip), 0)
end

local stringify = pandoc.utils.stringify

local function warn(message)
  if pandoc.log and pandoc.log.warn then pandoc.log.warn(message)
  else io.stderr:write("[WARNING] mdz.lua: ", message, "\n") end
end

local function fail(err)
  error("mdz.lua: " .. tostring(err), 0)
end

local MIME = {
  png = "image/png", jpg = "image/jpeg", jpeg = "image/jpeg", gif = "image/gif",
  svg = "image/svg+xml", webp = "image/webp", avif = "image/avif", bmp = "image/bmp",
  tif = "image/tiff", tiff = "image/tiff", ico = "image/x-icon", pdf = "application/pdf",
}
local function mime_of(path)
  local ext = path:match("%.([^./]+)$")
  return ext and MIME[ext:lower()] or nil
end

-- A srcset ("logo-2x.png 2x, logo.png 1x", as in an EPUB) with each picture
-- rewritten by fn(src, true), or nil if any of them can't be. A browser shows
-- srcset in preference to src, so a srcset that can't be rewritten is dropped,
-- and src is shown instead. (Pandoc's EPUB reader loads only the src pictures,
-- so an EPUB's srcset is always dropped.) The true asks fn not to warn: a
-- missing srcset picture loses nothing.
local function rewrite_srcset(set, fn)
  local out = {}
  for candidate in set:gmatch("[^,]+") do
    local url, descriptor = candidate:match("^%s*(%S+)(.-)%s*$")
    local new = url and fn(url, true)
    if not new then return nil end
    out[#out + 1] = new .. descriptor
  end
  if #out == 0 then return nil end
  return table.concat(out, ", ")
end

-- An Image's src and srcset rewritten by fn(src); nil if src can't be.
local function rewrite_image(img, fn)
  local found = fn(img.src)
  if not found then return nil end
  img.src = found
  local set = img.attributes.srcset
  if set then img.attributes.srcset = rewrite_srcset(set, fn) end
  return img
end

-- Rewrite the src and srcset of <img> tags in raw HTML. fn(src) returns the
-- new src or nil.
local function rewrite_html_img(html, fn)
  return (html:gsub("(<[Ii][Mm][Gg]%f[%s/>][^>]*)", function(tag)
    tag = tag:gsub("([%s][Ss][Rr][Cc]%s*=%s*)([\"'])(.-)%2", function(pre, quote, src)
      local new = fn(src)
      if new then return pre .. quote .. new .. quote end
      return nil
    end)
    return (tag:gsub("([%s]+)([Ss][Rr][Cc][Ss][Ee][Tt]%s*=%s*)([\"'])(.-)%3", function(space, pre, quote, set)
      local new = rewrite_srcset(set, fn)
      if not new then return "" end
      return space .. pre .. quote .. new .. quote
    end))
  end))
end

---------------------------------------------------------------------------
-- Reading

-- commonmark_x by default: CommonMark, as MDZip editors render it (a list or
-- heading right after a paragraph, editor-style heading identifiers, no figure
-- captions made from alt text), plus most of Pandoc's extensions.
local function reader_format(opts)
  local ext = opts.extensions
  local fmt = "commonmark_x"
  if ext:includes("gfm") then fmt = "gfm"
  elseif ext:includes("pandoc") then fmt = "markdown" end
  if not ext:includes("raw_html") then
    fmt = fmt .. "-raw_html"
    -- Pandoc's Markdown turns <div> and <span> tags into Divs and Spans with
    -- their attributes (onclick and all); with -raw_html they're dropped too.
    if fmt:match("^markdown") then fmt = fmt .. "-native_divs-native_spans" end
  end
  return fmt
end

-- -raw_html, for an .mdz from someone you don't trust. Pandoc's CommonMark and
-- GFM readers ignore -raw_html and keep raw HTML anyway, and attributes in
-- {...} can carry event handlers, so the reader removes them itself: raw HTML,
-- on* attributes, and javascript:/vbscript:/data:text/html link targets.
local function unsafe_url(url)
  local u = url:gsub("[%s%c]", ""):lower()
  return u:match("^javascript:") or u:match("^vbscript:") or u:match("^data:text/html")
end
local function clean_attr(el)
  if el.attr then
    local attrs, changed = {}, false
    for k, v in pairs(el.attr.attributes) do
      if k:lower():match("^on") then changed = true else attrs[k] = v end
    end
    if changed then el.attr.attributes = attrs; return el end
  end
end
-- HTML that GFM and CommonMark need for what they have no syntax for is read
-- as what it stands for. Pandoc's writers, mdz.lua's included, write such
-- things as HTML: a table whose cells hold headings, lists or several
-- paragraphs, or has merged cells; a picture with a size (every picture from
-- Word has one); a figure with a caption; underline, superscript, subscript,
-- highlight, small caps. Word, PDF and the other formats that aren't HTML drop
-- raw HTML, and with it the table or picture, or the formatting.
local function whole_element(text, name)
  local lower = text:lower()
  return lower:match("^%s*<" .. name .. "[%s>]") and lower:match("</" .. name .. ">%s*$")
end

local function single_img(text)
  return text:match("^%s*<[Ii][Mm][Gg]%f[%s/>][^<>]*>%s*$") ~= nil
end

-- A picture's size in its style (style="width:2in;height:1in", as Pandoc
-- writes it) becomes its width and height, which Word and PDF output use.
local function size_from_style(img)
  local style = img.attributes.style
  if not style then return nil end
  local rest = style
  for _, key in ipairs({ "width", "height" }) do
    local value = style:match("%f[%w-]" .. key .. "%s*:%s*([^;]+)")
    if value and not img.attributes[key] then
      img.attributes[key] = value:gsub("%s+$", "")
      rest = rest:gsub("%f[%w-]" .. key .. "%s*:%s*[^;]+;?", "")
    end
  end
  if rest:match("^[%s;]*$") then img.attributes.style = nil else img.attributes.style = rest end
  return img
end

local function read_html_blocks(text)
  local ok, parsed = pcall(pandoc.read, text, "html")
  if ok and #parsed.blocks > 0 then return parsed.blocks:walk({ Image = size_from_style }) end
end

local function read_html_image(text)
  local blocks = read_html_blocks(text)
  local found
  if blocks then
    pandoc.Blocks(blocks):walk({ Image = function(img) found = found or img end })
  end
  return found
end

-- Tags that come in pairs around text: what each becomes.
local INLINE_TAGS = {
  u = pandoc.Underline, ins = pandoc.Underline,
  sup = pandoc.Superscript, sub = pandoc.Subscript,
  s = pandoc.Strikeout, del = pandoc.Strikeout, strike = pandoc.Strikeout,
  b = pandoc.Strong, strong = pandoc.Strong, i = pandoc.Emph, em = pandoc.Emph,
  mark = function(content) return pandoc.Span(content, pandoc.Attr("", { "mark" })) end,
}

-- An opening tag's name and what it becomes, or nil for one left alone.
local function open_tag(text)
  local name, rest = text:match("^<(%a+)(.-)>$")
  if not name then return nil end
  name = name:lower()
  if name == "span" then
    -- Only a span whose one attribute is class="mark" or class="smallcaps".
    local class = rest:match('^%s+class="([%w-]+)"%s*$') or rest:match("^%s+class='([%w-]+)'%s*$")
    if class == "mark" then return name, INLINE_TAGS.mark end
    if class == "smallcaps" then return name, pandoc.SmallCaps end
    return nil
  end
  if rest:match("^%s*$") and INLINE_TAGS[name] then return name, INLINE_TAGS[name] end
  return nil
end

local function is_html(el) return el.t == "RawInline" and el.format:match("^html") end

local function pair_tags(inlines)
  local out = pandoc.Inlines({})
  local i, n = 1, #inlines
  while i <= n do
    local el = inlines[i]
    local done = false
    if is_html(el) and single_img(el.text) then
      local img = read_html_image(el.text)
      if img then out:insert(img); done = true end
    elseif is_html(el) then
      local name, make = open_tag(el.text)
      if name then
        -- Its closing tag in the same run of text, counting nested ones.
        local depth, close = 0, nil
        for j = i + 1, n do
          local o = inlines[j]
          if is_html(o) then
            local t = o.text:lower()
            if t:match("^<" .. name .. "[%s>]") then depth = depth + 1
            elseif t:match("^</" .. name .. "%s*>$") then
              if depth == 0 then close = j; break end
              depth = depth - 1
            end
          end
        end
        if close then
          local content = pandoc.Inlines({})
          for j = i + 1, close - 1 do content:insert(inlines[j]) end
          out:insert(make(pair_tags(content)))
          i = close
          done = true
        end
      end
    end
    if not done then out:insert(el) end
    i = i + 1
  end
  return out
end

local html_to_native = {
  RawBlock = function(raw)
    if not raw.format:match("^html") then return nil end
    if whole_element(raw.text, "table") or whole_element(raw.text, "figure") or single_img(raw.text) then
      return read_html_blocks(raw.text)
    end
  end,
  Inlines = pair_tags,
}

local strip_raw_html = {
  RawBlock = function(raw) if raw.format:match("^html") then return {} end end,
  RawInline = function(raw) if raw.format:match("^html") then return {} end end,
  Link = function(link)
    if unsafe_url(link.target) then return link.content end
    return clean_attr(link)
  end,
  Image = function(img) if unsafe_url(img.src) then return {} end return clean_attr(img) end,
  Div = clean_attr, Span = clean_attr, Header = clean_attr, Code = clean_attr,
  CodeBlock = clean_attr, Table = clean_attr, Figure = clean_attr,
}

-- +combine: the entry point and the documents it links to, as one document
-- (spec 5.7.2 allows a single output from them). Documents come in the order
-- links to them first appear, depth-first from the entry point, each once.
-- In a project-mode archive, a collection (spec 5.7.3 allows one output that
-- keeps each document a distinct part): every document, those nothing links
-- to included, with the manifest's title rather than the first document's.
-- Each is wrapped in a Div whose id comes from its path (docs/setup.md ->
-- docs-setup); identifiers in documents other than the entry point get that
-- prefix (docs-setup--install), and links between documents become links
-- inside the result. +orphans adds documents nothing links to, by path;
-- +pagebreaks starts each document after the first on a new page.

local PAGEBREAK = {
  { "openxml", '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' },
  { "latex", "\\newpage{}" },
  { "html", '<div style="break-after: page"></div>' },
}

local function each_identifier(fn)
  local function f(el)
    if el.identifier and el.identifier ~= "" then return fn(el) end
  end
  return { Header = f, Div = f, Span = f, CodeBlock = f, Code = f, Link = f, Image = f, Table = f, Figure = f }
end

local function combine_documents(archive, entry, read_doc, ext, collection)
  local is_doc = {}
  for _, d in ipairs(archive:documents()) do is_doc[d] = true end

  local order, parsed = {}, {}
  local function visit(path)
    if parsed[path] then return end
    parsed[path] = read_doc(path)
    order[#order + 1] = path
    local targets = {}
    parsed[path]:walk({
      Link = function(l)
        local r = archive:resolve_link(path, l.target)
        if r.kind == "internal" and is_doc[r.entry] then targets[#targets + 1] = r.entry end
      end,
    })
    for _, t in ipairs(targets) do visit(t) end
  end
  visit(entry)

  local left = {}
  for _, d in ipairs(archive:documents()) do
    if not parsed[d] then left[#left + 1] = d end
  end
  table.sort(left)
  if #left > 0 then
    if collection or ext:includes("orphans") then
      for _, d in ipairs(left) do visit(d) end
    else
      warn(#left .. " document" .. (#left == 1 and "" or "s") .. " nothing links to left out (add +orphans to include "
        .. (#left == 1 and "it" or "them") .. "): " .. table.concat(left, ", "))
    end
  end

  -- Prefixes, kept clear of the entry point's own identifiers.
  local used, prefix = {}, {}
  parsed[entry]:walk(each_identifier(function(el) used[el.identifier] = true end))
  for _, path in ipairs(order) do
    -- Letters (any script), digits, _ and . stay; everything else becomes -.
    local chars = {}
    for _, c in utf8.codes((path:gsub("%.[^./]+$", ""))) do
      local ch = utf8.char(c)
      chars[#chars + 1] = (c >= 128 or ch:match("[%w_.]")) and ch or "-"
    end
    local p = pandoc.text.lower(table.concat(chars)):gsub("%-%-+", "-"):gsub("^%-+", ""):gsub("%-+$", "")
    if p == "" then p = "document" end
    local base, n = p, 2
    while used[p] do p = base .. "-" .. n; n = n + 1 end
    used[p] = true
    prefix[path] = p
  end

  local function anchor(target, fragment)
    if fragment == nil or fragment == "" then return "#" .. prefix[target] end
    if target == entry then return "#" .. fragment end
    return "#" .. prefix[target] .. "--" .. fragment
  end

  local blocks = pandoc.Blocks({})
  for i, path in ipairs(order) do
    local d = parsed[path]:walk({
      Link = function(l)
        local r = archive:resolve_link(path, l.target)
        if r.kind == "internal" and prefix[r.entry] then
          l.target = anchor(r.entry, r.fragment)
          return l
        end
      end,
    })
    if path ~= entry then
      local pre = prefix[path] .. "--"
      d = d:walk(each_identifier(function(el) el.identifier = pre .. el.identifier; return el end))
    end
    if i > 1 and ext:includes("pagebreaks") then
      for _, pb in ipairs(PAGEBREAK) do blocks:insert(pandoc.RawBlock(pb[1], pb[2])) end
    end
    blocks:insert(pandoc.Div(d.blocks, pandoc.Attr(prefix[path], { "mdz-document" }, { path = path })))
  end
  -- A collection is the archive's, not its first document's: the manifest
  -- fills in its title and the rest (below).
  return pandoc.Pandoc(blocks, collection and pandoc.Meta({}) or parsed[entry].meta)
end

-- MDZ_DOCUMENT: the document to start from instead of the entry point, by its
-- path in the archive ("chapters/install.md", "./chapters/install.md",
-- "chapters\install.md"). nil when it isn't set.
local function named_document(archive)
  local wanted = os.getenv("MDZ_DOCUMENT")
  if wanted == nil or wanted == "" then return nil end
  local path = wanted:gsub("\\", "/"):gsub("^%./", "")
  local docs = archive:documents()
  for _, d in ipairs(docs) do
    if d == path then return d end
  end
  local found = archive:find(path)
  for _, d in ipairs(docs) do
    if d == found then return d end
  end
  fail("MDZ_DOCUMENT names " .. wanted .. ", which isn't a Markdown document in this archive. Its documents: "
    .. table.concat(docs, ", "))
end

function ByteStringReader(input, opts)
  local archive, err = mdzip.open(input)
  if not archive then fail(err) end
  local entry, eerr = archive:entry_point()
  if not entry then fail(eerr) end
  local mode, merr = archive:mode()
  if not mode then fail(merr) end
  local ext = opts.extensions
  local combine = ext:includes("combine")
  local others = #archive:documents() - 1
  local named = named_document(archive)
  local start = named or entry
  if mode == "project" then
    if not combine and not named and others > 0 then
      warn("this is a project-mode archive; converting only its entry point, " .. entry
        .. " (" .. others .. " other document" .. (others == 1 and "" or "s") .. " left out; name one with "
        .. "MDZ_DOCUMENT, or add +combine to collect them all)")
    end
  elseif others > 0 and not combine and not named then
    warn("converting only the entry point, " .. entry .. ", of " .. (others + 1)
      .. " documents; add +combine to include the ones it links to")
  end
  local fmt = reader_format(opts)

  -- Images: resolve against the document they're in, load from the archive
  -- into the media bag under their archive path, and point the document at it.
  local loaded = {}
  local function load(from, src, quiet)
    local r = archive:resolve_link(from, src)
    if r.kind ~= "internal" then
      if r.kind == "unresolved" and not quiet then warn("image not in the archive: " .. src) end
      return nil
    end
    if not loaded[r.entry] then
      local bytes, rerr = archive:read(r.entry)
      if not bytes then warn("can't read " .. r.entry .. ": " .. tostring(rerr)); return nil end
      pandoc.mediabag.insert(r.entry, mime_of(r.entry), bytes)
      loaded[r.entry] = true
    end
    return r.entry
  end
  local function read_doc(path)
    local text, terr = archive:read_text(path)
    if not text then fail(terr) end
    local function here(src, quiet) return load(path, src, quiet) end
    local parsed = pandoc.read(text, fmt, opts)
    if opts.extensions:includes("raw_html") then
      parsed = parsed:walk(html_to_native)
    else
      parsed = parsed:walk(strip_raw_html)
    end
    return parsed:walk({
      Image = function(img) return rewrite_image(img, here) end,
      RawInline = function(raw)
        if raw.format == "html" then raw.text = rewrite_html_img(raw.text, here); return raw end
      end,
      RawBlock = function(raw)
        if raw.format == "html" then raw.text = rewrite_html_img(raw.text, here); return raw end
      end,
    })
  end

  local doc
  if combine then
    doc = combine_documents(archive, start, read_doc, ext, mode == "project")
  else
    doc = read_doc(start)
  end

  -- Manifest metadata fills in what the document doesn't say itself.
  local m = archive:manifest()
  if m then
    local meta = doc.meta
    if meta.title == nil and archive:title() then meta.title = archive:title() end
    if meta.author == nil and type(m.author) == "table" and type(m.author.name) == "string" then
      meta.author = m.author.name
    end
    if meta.lang == nil and type(m.language) == "string" then meta.lang = m.language end
    if meta.description == nil and type(m.description) == "string" then meta.description = m.description end
    if meta.keywords == nil and mdzip.json.is_array(m.keywords) then
      local kw = {}
      for i = 1, #m.keywords do if type(m.keywords[i]) == "string" then kw[#kw + 1] = m.keywords[i] end end
      if #kw > 0 then meta.keywords = kw end
    end
    -- The manifest's cover picture goes into the media bag and metadata as
    -- "cover", for a web page's preview picture (og:image) once mdz-images.lua
    -- publishes it. (Not cover-image: Pandoc's EPUB writer reads that from
    -- disk, where this picture isn't.)
    if meta.cover == nil and type(m.cover) == "string" then
      local cover = m.cover:gsub("^%./", "", 1)
      local name = cover ~= "" and archive:find(cover) or nil
      local bytes = name and archive:read(name)
      if bytes then
        if not loaded[name] then pandoc.mediabag.insert(name, mime_of(name), bytes); loaded[name] = true end
        meta.cover = name
      else
        warn("manifest cover names a file that is not in the archive; ignored: " .. m.cover)
      end
    end
    -- Export hints for Pandoc (an mdzip-pandoc field, not part of the spec):
    -- "pandoc": { "referenceDoc": "styles/reference.docx" }. The reference
    -- document goes into the media bag, and docx.lua passes it to Pandoc's
    -- Word writer; a reader can't set writer options itself.
    if type(m.pandoc) == "table" and type(m.pandoc.referenceDoc) == "string" then
      local ref = m.pandoc.referenceDoc:gsub("^%./", "", 1)
      local name = ref ~= "" and archive:find(ref) or nil
      local bytes = name and archive:read(name)
      if bytes and name:lower():match("%.do[ct]x$") then
        pandoc.mediabag.insert(name, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes)
        meta["mdz-reference-doc"] = name
      else
        warn("manifest pandoc.referenceDoc must name a .docx or .dotx file in the archive; ignored: "
          .. m.pandoc.referenceDoc)
      end
    end
    doc.meta = meta
  end

  -- A document that starts with its own title as a heading ("# Trip Notes",
  -- with "Trip Notes" as the manifest's title, as writing an .mdz from Word
  -- adds it) would show it twice: Pandoc writes the title as a title block
  -- (Word's Title style, a web page's title header) above it. The heading
  -- goes; the title stays, in the title block and the file's properties.
  local title = doc.meta.title and stringify(doc.meta.title) or nil
  local first = doc.blocks[1]
  if title and first and first.t == "Header" and first.level == 1 then
    local same = function(text) return text:gsub("%s+", " "):match("^%s*(.-)%s*$"):lower() end
    if same(stringify(first.content)) == same(title) then doc.blocks:remove(1) end
  end
  return doc
end

---------------------------------------------------------------------------
-- Writing

local function writer_format(opts)
  local ext = opts.extensions
  if ext:includes("pandoc") then return "markdown" end
  if ext:includes("commonmark") then return "commonmark_x" end
  return "gfm"
end

-- A safe archive name for an image: its file name under images/, with
-- characters the spec doesn't allow in entry names replaced.
local function image_name(src)
  local name = src:gsub("[?#].*$", ""):match("([^/\\]+)$") or "image"
  name = name:gsub('[%c\\:%*%?"<>|]', "_")
  if name == "" or name == "." or name == ".." then name = "image" end
  if not name:find("%.[^.]+$") then name = name .. ".bin" end
  return name
end

---------------------------------------------------------------------------
-- Writing from a Word file: what Pandoc's Word reader leaves out

-- When the input is a Word file, mdz.lua reads it again for what Pandoc's
-- reader doesn't keep: the sizes of older pictures, and each table's shading
-- and lines. Nil when the input isn't one Word file, or can't be read.
local WORD_INPUT = { docx = true, docm = true, dotx = true, dotm = true }
local word_input_cache

local function word_input()
  if word_input_cache ~= nil then return word_input_cache or nil end
  word_input_cache = false
  local inputs = PANDOC_STATE.input_files or {}
  if #inputs ~= 1 then return nil end
  local ext = inputs[1]:match("%.(%w+)$")
  if not ext or not WORD_INPUT[ext:lower()] then return nil end
  local ok, parts = pcall(function()
    local fh = io.open(inputs[1], "rb")
    if not fh then return nil end
    local data = fh:read("a"); fh:close()
    local found = { bytes = data }
    for _, e in ipairs(pandoc.zip.Archive(data).entries) do
      if e.path == "word/document.xml" then found.xml = e:contents()
      elseif e.path == "word/_rels/document.xml.rels" then found.rels = e:contents() end
    end
    return found.xml and found or nil
  end)
  if ok and parts then word_input_cache = parts end
  return word_input_cache or nil
end

-- Pandoc's Word reader takes only the first drawing in a run, so a picture
-- that shares a run with a shape or another picture (a logo drawn on a
-- banner, say) is lost. The Word file with such runs split, one drawing in
-- each, or nil when it has none.
local DRAWING_ENDS = { "</w:drawing>", "</mc:AlternateContent>", "</w:pict>" }
local DRAWING_STARTS = { "<w:drawing[%s>]", "<mc:AlternateContent[%s>]", "<w:pict[%s>]" }

local function split_drawing_runs(xml)
  local total = 0
  for _, close in ipairs(DRAWING_ENDS) do
    for _, open in ipairs(DRAWING_STARTS) do
      local n
      xml, n = xml:gsub("(" .. close:gsub("%p", "%%%0") .. ")(%s*" .. open .. ")", "%1</w:r><w:r>%2")
      total = total + n
    end
  end
  return total > 0 and xml or nil
end

-- The document read again from the Word file with its drawing runs split,
-- keeping the metadata Pandoc gave it (the command line's too); nil when
-- nothing needs it or it can't be read.
local function reread_split_drawings(doc)
  local word = word_input()
  if not word or not word.bytes then return nil end
  local split = split_drawing_runs(word.xml)
  if not split then return nil end
  local ok, result = pcall(function()
    local entries = {}
    for _, e in ipairs(pandoc.zip.Archive(word.bytes).entries) do
      if e.path == "word/document.xml" then
        entries[#entries + 1] = pandoc.zip.Entry(e.path, split, e.modtime)
      else
        entries[#entries + 1] = e
      end
    end
    local again = pandoc.read(pandoc.zip.Archive(entries):bytestring(), "docx")
    again.meta = doc.meta
    return again
  end)
  if not ok then
    warn("pictures sharing a line with a shape may be missing: " .. tostring(result))
    return nil
  end
  word.unsplit = word.unsplit or word.xml
  word.xml = split
  return result
end

-- Pictures in older Word documents (VML, <w:pict><v:shape style="width:73.55pt;
-- height:68.85pt">) have their size in the shape's style, which Pandoc's Word
-- reader ignores, so they'd show at their pixel size: a small logo, huge.
-- For each picture (media/image1.png), the sizes it's shown at, in order.
local function to_inches(value)
  local n, unit = value:match("^%s*([%d.]+)%s*(%a*)%s*$")
  n = tonumber(n)
  if not n or n <= 0 then return nil end
  local per_inch = ({ pt = 72, ["in"] = 1, cm = 2.54, mm = 25.4, px = 96, [""] = 96 })[unit:lower()]
  if not per_inch then return nil end
  return string.format("%.4gin", n / per_inch)
end

local function word_picture_sizes()
  local word = word_input()
  if not word or not word.rels then return nil end
  local target = {}
  for rel in word.rels:gmatch("<Relationship%s[^>]*>") do
    local id, to = rel:match('%sId="([^"]+)"'), rel:match('%sTarget="([^"]+)"')
    if id and to then target[id] = to end
  end
  local found = {}
  for shape in word.xml:gmatch("<v:shape%s.-</v:shape>") do
    local style = shape:match('^<v:shape%s[^>]-%sstyle="([^"]*)"')
    local id = shape:match('<v:imagedata%s[^>]-r:id="([^"]+)"')
    local to = id and target[id]
    if style and to then
      local w, h = style:match("%f[%w-]width%s*:%s*([^;]+)"), style:match("%f[%w-]height%s*:%s*([^;]+)")
      w, h = w and to_inches(w), h and to_inches(h)
      if w and h then
        to = to:gsub("^/word/", ""):gsub("^%./", "")
        found[to] = found[to] or {}
        table.insert(found[to], { w, h })
      end
    end
  end
  return next(found) and found or nil
end

-- A picture drawn on a shape (a white logo on a coloured banner): Pandoc
-- keeps the picture but not the shape, so the logo would be white on white.
-- For each such picture (media/image1.png), the shape's fill as a CSS
-- background: its colour, or its gradient. Word puts the two in one run,
-- the shape first (mc:AlternateContent), then the picture.
local function shape_fill(shape)
  local properties = shape:match("<wps:spPr[%s>].-</wps:spPr>")
  if not properties then return nil end
  local solid = properties:match('<a:solidFill>%s*<a:srgbClr val="(%x%x%x%x%x%x)"')
  if solid then return "#" .. solid:upper() end
  local gradient = properties:match("<a:gradFill[%s>].-</a:gradFill>")
  if not gradient then return nil end
  local stops = {}
  for at, colour in gradient:gmatch('<a:gs pos="(%d+)">%s*<a:srgbClr val="(%x%x%x%x%x%x)"') do
    stops[#stops + 1] = string.format("#%s %g%%", colour:upper(), tonumber(at) / 1000)
  end
  if #stops == 1 then return stops[1]:match("^#%x+") end
  if #stops == 0 then return nil end
  -- Word's angle (60000ths of a degree) runs from left to right at 0; CSS's
  -- from bottom to top.
  local angle = tonumber(gradient:match('<a:lin ang="(%d+)"') or "0") / 60000
  return string.format("linear-gradient(%gdeg, %s)", (angle + 90) % 360, table.concat(stops, ", "))
end

local function word_picture_backdrops()
  local word = word_input()
  if not word or not word.rels then return nil end
  local xml = word.unsplit or word.xml
  local target = {}
  for rel in word.rels:gmatch("<Relationship%s[^>]*>") do
    local id, to = rel:match('%sId="([^"]+)"'), rel:match('%sTarget="([^"]+)"')
    if id and to then target[id] = to:gsub("^/word/", ""):gsub("^%./", "") end
  end
  local found, at = {}, 1
  while true do
    local close, after = xml:find("</mc:AlternateContent>%s*<w:drawing[%s>]", at)
    if not close then break end
    at = after
    -- The shape: from the last <mc:AlternateContent> before it.
    local open, from = nil, 1
    while true do
      local s = xml:find("<mc:AlternateContent[%s>]", from)
      if not s or s > close then break end
      open, from = s, s + 1
    end
    local drawing = xml:match("<w:drawing[%s>].-</w:drawing>", xml:find("<w:drawing", close, true))
    local fill = open and shape_fill(xml:sub(open, close))
    local id = drawing and drawing:match('r:embed="([^"]+)"')
    if fill and id and target[id] then found[target[id]] = fill end
  end
  return next(found) and found or nil
end

local function backdrop_word_pictures(doc)
  local backdrops = word_picture_backdrops()
  if not backdrops then return doc end
  local function backdrop_of(block)
    local fill
    block:walk({ Image = function(img) fill = fill or backdrops[img.src] end })
    return fill
  end
  local function wrap(block)
    local fill = backdrop_of(block)
    if not fill then return nil end
    return pandoc.Div({ block }, pandoc.Attr("", { "mdz-backdrop" }, { style = "background:" .. fill .. ";padding:12pt" }))
  end
  return doc:walk({ Para = wrap, Plain = wrap })
end

local function size_word_pictures(doc)
  local sizes = word_picture_sizes()
  if not sizes then return doc end
  return doc:walk({
    Image = function(img)
      if img.attributes.width or img.attributes.height then return nil end
      local queue = sizes[img.src]
      local size = queue and table.remove(queue, 1)
      if size then
        img.attributes.width, img.attributes.height = size[1], size[2]
        return img
      end
    end,
  })
end

-- A Word document's tables, in the order they start (a table inside a cell
-- comes after the table it's in): each one's properties (w:tblPr) and its
-- own cells' properties (w:tcPr), leaving out the cells a merge continues
-- into, which Pandoc doesn't have either.
local function word_tables(xml)
  local tables, open = {}, {}
  for pos, slash, name in xml:gmatch("()<(/?)w:(%a+)[%s/>]") do
    if name == "tbl" then
      if slash == "" then
        local t = { props = xml:match("^<w:tbl>%s*<w:tblPr>(.-)</w:tblPr>", pos) or "", cells = {} }
        tables[#tables + 1] = t
        open[#open + 1] = t
      else
        open[#open] = nil
      end
    elseif name == "tc" and slash == "" and #open > 0 then
      local props = xml:match("^<w:tc[^>]*>%s*<w:tcPr>(.-)</w:tcPr>", pos) or ""
      local merge = props:match("<w:vMerge%s*/>") or props:match('<w:vMerge%s+w:val="continue"')
      if not merge then table.insert(open[#open].cells, props) end
    end
  end
  return tables
end

-- A cell's shading as a colour (Word's patterns, such as 20% dots, as the
-- flat colour they look like), or nil for none or white.
local function hex_rgb(hex)
  return tonumber(hex:sub(1, 2), 16), tonumber(hex:sub(3, 4), 16), tonumber(hex:sub(5, 6), 16)
end

local function shading_colour(props)
  local shd = props:match("<w:shd%s[^>]*>")
  if not shd then return nil end
  local val = shd:match('w:val="([^"]+)"') or "clear"
  local fill = shd:match('w:fill="([^"]+)"') or "auto"
  local colour = shd:match('w:color="([^"]+)"') or "auto"
  if fill == "auto" then fill = "FFFFFF" end
  if colour == "auto" then colour = "000000" end
  if not fill:match("^%x%x%x%x%x%x$") or not colour:match("^%x%x%x%x%x%x$") then return nil end
  local share = 0
  if val == "solid" then share = 1
  elseif val:match("^pct%d+$") then share = tonumber(val:match("%d+")) / 100 end
  local fr, fg, fb = hex_rgb(fill)
  local cr, cg, cb = hex_rgb(colour)
  local mix = function(f, c) return math.floor(f * (1 - share) + c * share + 0.5) end
  local result = string.format("%02X%02X%02X", mix(fr, cr), mix(fg, cg), mix(fb, cb))
  if result == "FFFFFF" then return nil end
  return result
end

-- A table's lines, compactly: "top:single/4/000000;insideH:single/4/000000".
local BORDER_EDGES = { "top", "left", "start", "bottom", "right", "end", "insideH", "insideV" }

local function borders_spec(borders)
  local parts = {}
  for _, edge in ipairs(BORDER_EDGES) do
    local el = borders:match("<w:" .. edge .. "%s[^>]*>")
    if el then
      parts[#parts + 1] = edge .. ":" .. (el:match('w:val="([^"]+)"') or "single") .. "/"
        .. (el:match('w:sz="(%d+)"') or "4") .. "/" .. (el:match('w:color="([^"]+)"') or "auto")
    end
  end
  return table.concat(parts, ";")
end

-- The tables of the document being written, in the same order as
-- word_tables: footnotes' tables are in another part of the Word file.
local function each_table(doc, fn)
  return doc:walk({
    traverse = "topdown",
    Note = function(note) return note, false end,
    Table = function(tbl) return fn(tbl) end,
  })
end

local function each_cell(tbl, fn)
  local function rows(list) for _, row in ipairs(list) do for _, cell in ipairs(row.cells) do fn(cell) end end end
  rows(tbl.head.rows)
  for _, body in ipairs(tbl.bodies) do rows(body.head); rows(body.body) end
  rows(tbl.foot.rows)
end

-- +table_look: each table's look from the Word file, kept in the .mdz as
-- HTML: a shaded cell's colour (style="background-color:#CCCCCC") and the
-- table's lines (data-word-borders) or Word table style (data-word-style),
-- where they aren't the document's usual table look. Studio's styles-only
-- copy of the document gives Pandoc's "Table" style that usual look (the
-- style or lines most tables have, as here), so most tables need nothing.
-- docx.lua puts them back when writing Word. A table whose cells don't
-- line up with the Word file's is left as it is.
local function add_table_look(doc)
  local word = word_input()
  if not word then return doc end
  local source = word_tables(word.xml)
  if #source == 0 then return doc end
  local counts, usual = {}, nil
  for _, t in ipairs(source) do
    t.style = t.props:match('<w:tblStyle%s+w:val="([^"]+)"')
    t.borders = t.props:match("<w:tblBorders>.-</w:tblBorders>")
    t.look = t.props:match("<w:tblLook%s[^>]*>")
    t.key = tostring(t.style) .. "|" .. tostring(t.borders)
    counts[t.key] = (counts[t.key] or 0) + 1
    if not usual or counts[t.key] > counts[usual] then usual = t.key end
  end
  local index = 0
  return each_table(doc, function(tbl)
    index = index + 1
    local t = source[index]
    if not t then return nil end
    local n = 0
    each_cell(tbl, function() n = n + 1 end)
    if n ~= #t.cells then return nil end
    local changed = false
    if t.key ~= usual then
      if t.style then
        tbl.attributes["word-style"] = t.style
        if t.look then tbl.attributes["word-look"] = t.look:match("^<w:tblLook%s+(.-)%s*/?>$") end
      end
      tbl.attributes["word-borders"] = t.borders and borders_spec(t.borders) or "none"
      changed = true
    end
    local i = 0
    each_cell(tbl, function(cell)
      i = i + 1
      local colour = shading_colour(t.cells[i])
      if colour then
        cell.attributes.style = "background-color:#" .. colour
        changed = true
      end
    end)
    if changed then return tbl end
  end)
end

-- -image_sizes: pictures without sizes, so they're plain Markdown images.
local function drop_image_sizes(doc)
  return doc:walk({
    Image = function(img)
      img.attributes.width, img.attributes.height, img.attributes.style = nil, nil, nil
      return img
    end,
  })
end

-- -html_formatting: underline, superscript, subscript, small caps and
-- highlight, which Markdown can't write, as plain text; spans and divs
-- (HTML in Markdown) as what they hold.
local function drop_html_formatting(doc)
  local unwrap = function(el) return el.content end
  return doc:walk({
    Underline = unwrap, Superscript = unwrap, Subscript = unwrap, SmallCaps = unwrap,
    Span = unwrap,
    -- A picture's backdrop is image_sizes' business, not formatting.
    Div = function(div)
      if div.classes:includes("mdz-backdrop") then return nil end
      return div.content
    end,
  })
end

-- -html_tables: a table Markdown can't write (merged cells; headings, lists
-- or several paragraphs in a cell) made into one it can: each cell's content
-- as one line, headings in bold, list items joined with semicolons, and a
-- merged cell as that cell followed by empty ones.
local cell_inlines
function cell_inlines(blocks)
  local out = pandoc.Inlines({})
  local function add(inlines, sep)
    if #inlines == 0 then return end
    if #out > 0 then out:insert(sep or pandoc.Space()) end
    out:extend(inlines)
  end
  local function walk_blocks(list)
    for _, b in ipairs(list) do
      if b.t == "Plain" or b.t == "Para" then add(b.content)
      elseif b.t == "Header" then add({ pandoc.Strong(b.content) })
      elseif b.t == "LineBlock" then for _, line in ipairs(b.content) do add(line) end
      elseif b.t == "BulletList" or b.t == "OrderedList" then
        for k, item in ipairs(b.content) do
          if k > 1 and #out > 0 then out:insert(pandoc.Str(";")) end
          add(cell_inlines(item))
        end
      elseif b.t == "BlockQuote" or b.t == "Div" then walk_blocks(b.content)
      elseif b.t == "Figure" then walk_blocks(b.content)
      elseif b.t == "CodeBlock" then add({ pandoc.Code(b.text) })
      elseif b.t ~= "HorizontalRule" then add({ pandoc.Str(stringify(b)) })
      end
    end
  end
  walk_blocks(blocks)
  return out:walk({
    LineBreak = function() return pandoc.Space() end,
    SoftBreak = function() return pandoc.Space() end,
  })
end

local function simple_table(tbl)
  local ncols = #tbl.colspecs
  local pending = {}
  local function empty() return pandoc.Cell({}) end
  local function fix_rows(list)
    for _, row in ipairs(list) do
      local cells, col = {}, 1
      local function fill_pending()
        while pending[col] and pending[col] > 0 do
          pending[col] = pending[col] - 1
          cells[#cells + 1] = empty()
          col = col + 1
        end
      end
      for _, cell in ipairs(row.cells) do
        fill_pending()
        local cs, rs = cell.col_span, cell.row_span
        cell.col_span, cell.row_span = 1, 1
        cell.contents = { pandoc.Plain(cell_inlines(cell.contents)) }
        cells[#cells + 1] = cell
        if rs > 1 then for k = col, col + cs - 1 do pending[k] = rs - 1 end end
        for _ = 2, cs do cells[#cells + 1] = empty() end
        col = col + cs
      end
      while col <= ncols do
        if pending[col] and pending[col] > 0 then pending[col] = pending[col] - 1 end
        cells[#cells + 1] = empty()
        col = col + 1
      end
      row.cells = cells
    end
  end
  fix_rows(tbl.head.rows)
  for _, body in ipairs(tbl.bodies) do fix_rows(body.head); fix_rows(body.body) end
  fix_rows(tbl.foot.rows)
  -- Pipe tables size columns by their text, not Word's widths.
  for i, spec in ipairs(tbl.colspecs) do tbl.colspecs[i] = { spec[1], pandoc.ColWidthDefault } end
  return tbl
end

local function simplify_tables(doc)
  return doc:walk({ Table = simple_table })
end

-- A table with a look of its own (cell colours, lines, a Word style) is
-- written as HTML: Markdown's tables have nowhere to keep it.
local function has_look(tbl)
  if tbl.attributes["word-borders"] or tbl.attributes["word-style"] then return true end
  local found = false
  each_cell(tbl, function(cell) if cell.attributes.style then found = true end end)
  return found
end

local function tables_with_look_as_html(doc)
  return doc:walk({
    Table = function(tbl)
      if has_look(tbl) then
        return pandoc.RawBlock("html", pandoc.write(pandoc.Pandoc({ tbl }), "html"))
      end
    end,
  })
end

---------------------------------------------------------------------------
-- Conversion notes (+notes): sources/conversion-notes.md, saying where the
-- document came from and, from Word, what didn't come across. It's in
-- sources/, next to a kept original, not part of the document.

local NOTES_PATH = "sources/conversion-notes.md"

local FORMAT_NAMES = {
  docx = "Word document", docm = "Word document with macros", dotx = "Word template", dotm = "Word template with macros",
  odt = "OpenDocument text", rtf = "Rich Text", epub = "EPUB book", html = "web page", htm = "web page",
  md = "Markdown", markdown = "Markdown", txt = "text", tex = "LaTeX", rst = "reStructuredText", org = "Org",
  ipynb = "Jupyter notebook", pptx = "PowerPoint presentation", xlsx = "Excel workbook", csv = "CSV", typ = "Typst",
}

local function count(text, pattern)
  local n = 0
  for _ in (text or ""):gmatch(pattern) do n = n + 1 end
  return n
end

local function plural(n, one, many) return n .. " " .. (n == 1 and one or (many or one .. "s")) end

local function size_text(bytes)
  if bytes < 1024 then return bytes .. " bytes" end
  if bytes < 1024 * 1024 then return string.format("%.0f KB", bytes / 1024) end
  return string.format("%.1f MB", bytes / 1024 / 1024)
end

-- When it was converted: now, or SOURCE_DATE_EPOCH for a reproducible build.
local function converted_at()
  local epoch = tonumber(os.getenv("SOURCE_DATE_EPOCH") or "")
  return os.date("!%Y-%m-%d %H:%M UTC", epoch)
end

-- What a Word file had that the .mdz doesn't, counted in its XML. Each entry
-- is a line for the notes; empty when nothing checked for was there.
local function word_losses(backdrops)
  local word = word_input()
  if not word or not word.bytes then return nil end
  local xml = word.unsplit or word.xml
  local parts, macros = {}, false
  for _, e in ipairs(pandoc.zip.Archive(word.bytes).entries) do
    if e.path:match("^word/[^/]+%.xml$") then parts[e.path] = e:contents() end
    if e.path == "word/vbaProject.bin" then macros = true end
  end
  local lines = {}
  local function add(text) lines[#lines + 1] = "- " .. text end

  local comments = count(parts["word/comments.xml"], "<w:comment[%s>]")
  if comments > 0 then add("**Comments:** " .. plural(comments, "comment") .. ", left out.") end
  local ins, del = count(xml, "<w:ins[%s>]"), count(xml, "<w:del[%s>]")
  if ins + del > 0 then
    add("**Tracked changes:** " .. plural(ins, "insertion") .. " and " .. plural(del, "deletion")
      .. ", accepted: the text reads as if every change had been accepted.")
  end
  local shapes = count(xml, "<wps:wsp[%s>]")
  if shapes > 0 then
    add("**Shapes:** " .. plural(shapes, "shape") .. " (lines, boxes, banners), left out."
      .. (backdrops > 0 and (" " .. plural(backdrops, "picture") .. " drawn on one keep" .. (backdrops == 1 and "s" or "")
        .. " its colour behind " .. (backdrops == 1 and "it" or "them") .. ".") or ""))
  end
  local boxes = count(xml, "<wps:txbx[%s>]")
  if boxes == 0 then boxes = count(xml, "<v:textbox[%s>]") end
  if boxes > 0 then
    add("**Text boxes:** " .. plural(boxes, "text box", "text boxes")
      .. "; their text may be out of place or missing. Check them against the original.")
  end
  local fields, kinds = {}, {}
  local function field(instr)
    local kind = (instr or ""):match("^%s*(%u+)")
    if kind and kind ~= "HYPERLINK" then
      if not fields[kind] then kinds[#kinds + 1] = kind end
      fields[kind] = (fields[kind] or 0) + 1
    end
  end
  for instr in xml:gmatch("<w:instrText[^>]*>([^<]*)</w:instrText>") do field(instr) end
  for instr in xml:gmatch('<w:fldSimple[^>]-w:instr="([^"]*)"') do field(instr) end
  if #kinds > 0 then
    table.sort(kinds)
    add("**Fields** (" .. table.concat(kinds, ", ") .. "): their text as the file last showed it; "
      .. "they no longer update (a table of contents keeps its entries, page numbers stay as they were).")
  end
  local charts = count(xml, 'drawingml/2006/chart"')
  if charts > 0 then add("**Charts:** " .. plural(charts, "chart") .. ", left out.") end
  local diagrams = count(xml, 'drawingml/2006/diagram"')
  if diagrams > 0 then add("**SmartArt:** " .. plural(diagrams, "diagram") .. ", left out.") end
  local objects = count(xml, "<o:OLEObject[%s>]")
  if objects > 0 then add("**Embedded objects:** " .. plural(objects, "object") .. " (a spreadsheet, a file), left out.") end
  local columns = count(xml, '<w:cols [^>]-w:num="[2-9]')
  if columns > 0 then add("**Columns:** text laid out in several columns is in one.") end
  local headers = 0
  for path, part in pairs(parts) do
    if path:match("^word/header%d*%.xml$") or path:match("^word/footer%d*%.xml$") then
      if part:match("<w:t[%s>][^<]*%S") then headers = headers + 1 end
    end
  end
  if headers > 0 then
    add("**Headers and footers:** " .. plural(headers, "header or footer", "headers or footers")
      .. " with text, not part of the document. A Word template made from the original keeps them.")
  end
  if macros then add("**Macros:** left out.") end
  return lines
end

local function conversion_notes(doc, ext, images)
  local inputs = PANDOC_STATE.input_files or {}
  local lines = {
    "# Conversion notes",
    "",
    "How this document was made from its original, and what didn't come across. "
      .. "mdz.lua wrote it when it converted the file (`+notes`); it isn't part of the document.",
    "",
    "## Where it came from",
    "",
  }
  local function add(text) lines[#lines + 1] = text end
  for _, input in ipairs(inputs) do
    if input ~= "-" then
      local name = input:match("([^/\\]+)$") or input
      local kind = FORMAT_NAMES[(name:match("%.(%w+)$") or ""):lower()]
      local fh = io.open(input, "rb")
      local data = fh and fh:read("a")
      if fh then fh:close() end
      local about = { kind }
      if data then about[#about + 1] = size_text(#data) end
      add("- **Original:** `" .. name .. "`" .. (#about > 0 and (" (" .. table.concat(about, ", ") .. ")") or ""))
      if data then add("- **SHA-1:** `" .. pandoc.utils.sha1(data) .. "`") end
    end
  end
  add("- **Converted:** " .. converted_at())
  add("- **With:** Pandoc " .. tostring(PANDOC_VERSION) .. " and mdz.lua " .. VERSION)
  local switches = {}
  for _, name in ipairs({ "image_sizes", "html_tables", "table_look", "html_formatting" }) do
    if ext:includes(name) then switches[#switches + 1] = "`+" .. name .. "`" end
  end
  add("- **Kept as HTML:** " .. (#switches > 0 and table.concat(switches, " ") or "nothing (plain Markdown)"))
  add("")

  local backdrops, tables, html_tables, notes = 0, 0, 0, 0
  doc:walk({
    Div = function(div) if div.classes:includes("mdz-backdrop") then backdrops = backdrops + 1 end end,
    Table = function() tables = tables + 1 end,
    RawBlock = function(raw) if raw.format == "html" and raw.text:match("<table[%s>]") then html_tables = html_tables + 1 end end,
    Note = function() notes = notes + 1 end,
  })
  local losses = word_losses(backdrops)
  if losses then
    add("## What didn't come across")
    add("")
    if #losses == 0 then
      add("Nothing mdz.lua checks for: comments, tracked changes, shapes, text boxes, fields, charts, SmartArt, "
        .. "embedded objects, columns, headers and footers, macros.")
    else
      for _, line in ipairs(losses) do add(line) end
    end
    add("")
  end

  add("## What's in the archive")
  add("")
  add("- `index.md`: the document" .. ((tables + html_tables) > 0
    and (", with " .. plural(tables + html_tables, "table") .. (html_tables > 0 and (" (" .. html_tables .. " as HTML)") or ""))
    or "") .. (notes > 0 and (" and " .. plural(notes, "footnote")) or "") .. ".")
  if images > 0 then add("- `images/`: " .. plural(images, "picture") .. ".") end
  add("- `" .. NOTES_PATH .. "`: these notes.")
  return table.concat(lines, "\n") .. "\n"
end

function ByteStringWriter(doc, opts)
  -- Without -o Pandoc prints the result, and a ZIP is unreadable in a terminal.
  local out_file = PANDOC_STATE.output_file
  if out_file == nil or out_file == "-" then
    error("mdz.lua writes a ZIP archive, so it needs an output file: add -o name.mdz", 0)
  end
  local ext = opts.extensions
  doc = reread_split_drawings(doc) or doc
  -- A heading with only pictures in it (a logo Word anchored to a heading)
  -- isn't a heading: no empty entry in the outline.
  doc = doc:walk({
    Header = function(header)
      local pictures = false
      local text = header.content:walk({ Image = function() pictures = true; return {} end })
      if pictures and not pandoc.utils.stringify(text):match("%S") then return pandoc.Para(header.content) end
    end,
  })
  -- A link inside a link, as in a Word table of contents (the entry links to
  -- the heading, and so does its page number): Markdown has no nested links,
  -- so the whole entry would show as [text](#target) text. The inner link
  -- keeps its text.
  doc = doc:walk({
    Link = function(link)
      link.content = link.content:walk({ Link = function(inner) return inner.content end })
      return link
    end,
  })
  if ext:includes("image_sizes") then doc = backdrop_word_pictures(size_word_pictures(doc)) else doc = drop_image_sizes(doc) end
  if ext:includes("table_look") then doc = add_table_look(doc) end
  if not ext:includes("html_tables") then doc = simplify_tables(doc) end
  if not ext:includes("html_formatting") then doc = drop_html_formatting(doc) end
  if ext:includes("table_look") then doc = tables_with_look_as_html(doc) end
  local files = {}
  local by_src, used = {}, {}
  local missing = {}

  local function package(src, quiet)
    if by_src[src] ~= nil then return by_src[src] or nil end
    -- A URL scheme (two or more letters, so C:\ isn't one), other than data:.
    if src:match("^[a-zA-Z][a-zA-Z0-9+.-]+:") and not src:match("^data:") then
      by_src[src] = false -- web images stay links (spec 9.2)
      return nil
    end
    local mt, contents = pandoc.mediabag.lookup(src)
    if not contents then
      local ok, fetched_mt, data = pcall(pandoc.mediabag.fetch, src)
      if ok then mt, contents = fetched_mt, data end
    end
    if not contents then
      if quiet then return nil end -- not cached: the same picture as a src still warns
      by_src[src] = false
      missing[#missing + 1] = src
      return nil
    end
    local name
    if src:match("^data:") then
      local ext = ({ ["image/svg+xml"] = "svg", ["image/jpeg"] = "jpg" })[mt or ""]
        or (mt and mt:match("/(%w+)")) or "bin"
      name = "image." .. ext
    else
      name = image_name(src)
    end
    local base, ext = name:match("^(.*)(%.[^.]+)$")
    local candidate, n = "images/" .. name, 1
    while used[candidate] do n = n + 1; candidate = "images/" .. base .. "-" .. n .. ext end
    used[candidate] = true
    by_src[src] = candidate
    files[#files + 1] = { path = candidate, data = contents }
    return candidate
  end

  doc = doc:walk({
    Image = function(img) return rewrite_image(img, package) end,
    RawInline = function(raw)
      if raw.format == "html" then raw.text = rewrite_html_img(raw.text, package); return raw end
    end,
    RawBlock = function(raw)
      if raw.format == "html" then raw.text = rewrite_html_img(raw.text, package); return raw end
    end,
  })
  for _, src in ipairs(missing) do warn("image not found, left as a link: " .. src) end

  local meta = doc.meta
  local title = meta.title and stringify(meta.title) or nil
  if title == "" then title = nil end

  -- The title lives in metadata, which Markdown output drops; keep it visible
  -- as a heading when the document has no level-1 heading of its own.
  if title then
    local has_h1 = false
    for _, b in ipairs(doc.blocks) do
      if b.t == "Header" and b.level == 1 then has_h1 = true; break end
    end
    if not has_h1 then doc.blocks:insert(1, pandoc.Header(1, pandoc.Str(title))) end
  end

  -- GFM and CommonMark have no figures, so Pandoc would write <figure> HTML.
  -- A figure holding just an image becomes a plain image paragraph instead,
  -- with its caption, if it has one, as a paragraph under it.
  local format = writer_format(opts)
  if format ~= "markdown" then
    doc = doc:walk({
      Figure = function(fig)
        local blocks = fig.content
        if #blocks == 1 and (blocks[1].t == "Plain" or blocks[1].t == "Para") then
          local inlines = blocks[1].content
          local only_images = #inlines > 0
          for _, il in ipairs(inlines) do
            if il.t ~= "Image" and il.t ~= "Space" and il.t ~= "SoftBreak" then only_images = false end
          end
          if only_images then
            local out = pandoc.Blocks({ pandoc.Para(inlines) })
            for _, b in ipairs(fig.caption.long or {}) do
              out:insert(b.t == "Plain" and pandoc.Para(b.content) or b)
            end
            return out
          end
        end
      end,
    })
  end

  local markdown = pandoc.write(doc, format, pandoc.WriterOptions({
    wrap_text = opts.wrap_text, columns = opts.columns,
  }))
  if markdown:sub(-1) ~= "\n" then markdown = markdown .. "\n" end
  table.insert(files, 1, { path = "index.md", text = markdown })
  if ext:includes("notes") then
    files[#files + 1] = { path = NOTES_PATH, text = conversion_notes(doc, ext, #files - 1) }
  end

  local extra = {}
  local author = meta.author
  if author then
    local first = author
    if pandoc.utils.type(author) == "List" then first = author[1] end
    local name = first and stringify(first) or ""
    if name ~= "" then extra.author = { name = name } end
  end
  local lang = meta.lang and stringify(meta.lang) or ""
  if lang ~= "" then
    -- BCP 47 shape, as the core checks it: letter-led first subtag, then
    -- "-"-separated alphanumeric subtags of 1 to 8 characters.
    local ok = lang:match("^%a") ~= nil
    for part in (lang .. "-"):gmatch("([^-]*)%-") do
      if #part < 1 or #part > 8 or not part:match("^%w+$") then ok = false end
    end
    if ok then extra.language = lang
    else warn("lang '" .. lang .. "' isn't a language tag; not recorded") end
  end
  local description = meta.description and stringify(meta.description) or ""
  if description ~= "" then extra.description = description end
  if meta.keywords then
    local kw = {}
    local list = pandoc.utils.type(meta.keywords) == "List" and meta.keywords or { meta.keywords }
    for _, k in ipairs(list) do local s = stringify(k); if s ~= "" then kw[#kw + 1] = s end end
    if #kw > 0 then extra.keywords = kw end
  end

  local bytes, err = mdzip.create({
    files = files,
    title = title,
    entry_point = "index.md",
    application = { name = "mdz.lua for Pandoc " .. tostring(PANDOC_VERSION), version = VERSION, url = URL },
    manifest = next(extra) and extra or nil,
  })
  if not bytes then fail(err) end
  return bytes
end
