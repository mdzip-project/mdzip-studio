--[[
docx.lua: Pandoc's Word writer, with the reference document an .mdz carries.

  pandoc -f mdz.lua guide.mdz -t docx.lua -o guide.docx

An .mdz can name a Word reference document in its manifest, an mdzip-pandoc
field outside the MDZip spec:

  "pandoc": { "referenceDoc": "styles/reference.docx" }

mdz.lua reads it into the media bag, but only the writer can use it, so this
writer passes it to Pandoc's own Word writer as --reference-doc would. Word's
styles (tables, headings, fonts, page size) then come from it. A Word template
(.dotx) works too. --reference-doc on the command line still wins.

It also puts back what Pandoc's Word writer leaves out of an .mdz's HTML
tables: a cell's colour (style="background-color:#CCCCCC"), and a table's own
lines (data-word-borders) or Word table style (data-word-style). mdz.lua's
table_look keeps them when it writes an .mdz from a Word file.

Everything else is Pandoc's Word writer unchanged. Input that doesn't come
from an .mdz with a reference document is written with Pandoc's default one.
]]

local KEY = "mdz-reference-doc"

local function warn(message)
  if pandoc.log and pandoc.log.warn then pandoc.log.warn(message)
  else io.stderr:write("[WARNING] docx.lua: ", message, "\n") end
end

---------------------------------------------------------------------------
-- Table looks: cell colours, table lines and Word table styles

-- Pandoc's Word writer ignores a cell's colour and a table's own lines. An
-- .mdz keeps them in its HTML tables (mdz.lua's table_look, from Word, or
-- written by hand): style="background-color:#CCCCCC" on a cell, and on the
-- table data-word-borders ("top:single/4/000000;insideH:..." or "none") and
-- data-word-style (a table style in the reference document, with
-- data-word-look, its w:tblLook settings). They're added to the Word file
-- Pandoc writes, matching its tables and cells by order. A table whose cells
-- don't line up is left as Pandoc wrote it.

local function each_cell(tbl, fn)
  local function rows(list) for _, row in ipairs(list) do for _, cell in ipairs(row.cells) do fn(cell) end end end
  rows(tbl.head.rows)
  for _, body in ipairs(tbl.bodies) do rows(body.head); rows(body.body) end
  rows(tbl.foot.rows)
end

local function cell_colour(cell)
  local style = cell.attributes.style
  if not style then return nil end
  local value = style:match("background%-color%s*:%s*#(%x+)") or style:match("background%s*:%s*#(%x+)")
  if not value then return nil end
  if #value == 3 then value = value:gsub("(%x)", "%1%1") end
  if #value ~= 6 then return nil end
  return value:upper()
end

-- Each table's look, in the order Pandoc writes tables into the document
-- (footnotes' tables go into another part), or nil when none has one.
local function table_looks(doc)
  local looks, any = {}, false
  doc:walk({
    traverse = "topdown",
    Note = function(note) return note, false end,
    Table = function(tbl)
      local look = {
        borders = tbl.attributes["word-borders"],
        style = tbl.attributes["word-style"],
        tbllook = tbl.attributes["word-look"],
        cells = {},
      }
      local n = 0
      each_cell(tbl, function(cell) n = n + 1; look.cells[n] = cell_colour(cell) or false end)
      look.count = n
      if look.borders or look.style then any = true end
      for _, c in ipairs(look.cells) do if c then any = true end end
      looks[#looks + 1] = look
    end,
  })
  return any and looks or nil
end

local EDGES = { "top", "left", "start", "bottom", "right", "end", "insideH", "insideV" }

local function borders_xml(spec, styled)
  if spec == "none" then
    -- No lines of its own: its Word style's, or none at all.
    if styled then return nil end
    local parts = {}
    for _, edge in ipairs({ "top", "left", "bottom", "right", "insideH", "insideV" }) do
      parts[#parts + 1] = "<w:" .. edge .. ' w:val="nil"/>'
    end
    return "<w:tblBorders>" .. table.concat(parts) .. "</w:tblBorders>"
  end
  local by_edge = {}
  for edge, val, size, colour in spec:gmatch("(%w+):([%w]+)/(%d+)/(%w+)") do
    by_edge[edge] = string.format('<w:%s w:val="%s" w:sz="%s" w:space="0" w:color="%s"/>', edge, val, size, colour)
  end
  local parts = {}
  for _, edge in ipairs(EDGES) do parts[#parts + 1] = by_edge[edge] end
  if #parts == 0 then return nil end
  return "<w:tblBorders>" .. table.concat(parts) .. "</w:tblBorders>"
end

-- Insert `el` into a properties element's content before the first of
-- `later` (the elements the schema puts after it), or at the end.
local function insert_before(content, el, later)
  local at
  for _, name in ipairs(later) do
    local i = content:find("<w:" .. name .. "[%s/>]")
    if i and (not at or i < at) then at = i end
  end
  if not at then return content .. el end
  return content:sub(1, at - 1) .. el .. content:sub(at)
end

local AFTER_BORDERS = { "shd", "tblLayout", "tblCellMar", "tblLook", "tblCaption", "tblDescription", "tblPrChange" }
local AFTER_SHD = { "noWrap", "tcMar", "textDirection", "tcFitText", "vAlign", "hideMark", "headers", "cellIns", "cellDel", "cellMerge", "tcPrChange" }

local function table_props(props, look, styles)
  if look.style and styles:find('w:styleId="' .. look.style:gsub("%p", "%%%0") .. '"') then
    props = props:gsub('<w:tblStyle%s+w:val="[^"]*"%s*/>', '<w:tblStyle w:val="' .. look.style .. '"/>', 1)
    if look.tbllook then props = props:gsub("<w:tblLook%s[^>]*/>", "<w:tblLook " .. look.tbllook .. "/>", 1) end
  else
    look = { borders = look.borders }
  end
  if look.borders then
    local borders = borders_xml(look.borders, look.style ~= nil)
    if borders then
      props = props:gsub("<w:tblBorders>.-</w:tblBorders>", "")
      props = insert_before(props, borders, AFTER_BORDERS)
    end
  end
  return props
end

local function cell_props(props, colour)
  props = props:gsub("<w:shd%s[^>]*/>", "")
  return insert_before(props, '<w:shd w:val="clear" w:color="auto" w:fill="' .. colour .. '"/>', AFTER_SHD)
end

-- document.xml with the looks added.
local function add_looks(xml, looks, styles)
  -- The tables, in the order they start, each with its own cells (not those
  -- of a table inside one), leaving out cells a merge continues into.
  local tables, open = {}, {}
  for pos, slash, name in xml:gmatch("()<(/?)w:(%a+)[%s/>]") do
    if name == "tbl" then
      if slash == "" then
        local t = { pos = pos, cells = {} }
        tables[#tables + 1] = t
        open[#open + 1] = t
      else
        open[#open] = nil
      end
    elseif name == "tc" and slash == "" and #open > 0 then
      local head = xml:match("^<w:tc>%s*<w:tcPr%s*/>", pos) or xml:match("^<w:tc>%s*<w:tcPr>.-</w:tcPr>", pos) or ""
      if not (head:match("<w:vMerge%s*/>") or head:match('<w:vMerge%s+w:val="continue"')) then
        table.insert(open[#open].cells, pos)
      end
    end
  end

  local edits = {}
  for i, t in ipairs(tables) do
    local look = looks[i]
    if look and look.count == #t.cells then
      if look.borders or look.style then
        local s, props, e = xml:match("^<w:tbl>%s*()<w:tblPr>(.-)</w:tblPr>()", t.pos)
        if s then
          edits[#edits + 1] = { s, e, "<w:tblPr>" .. table_props(props, look, styles) .. "</w:tblPr>" }
        end
      end
      for k, pos in ipairs(t.cells) do
        local colour = look.cells[k]
        if colour then
          local start = pos + #"<w:tc>"
          local s, e = xml:match("^%s*()<w:tcPr%s*/>()", start)
          if s then
            edits[#edits + 1] = { s, e, "<w:tcPr>" .. cell_props("", colour) .. "</w:tcPr>" }
          else
            local s2, props, e2 = xml:match("^%s*()<w:tcPr>(.-)</w:tcPr>()", start)
            if s2 then
              edits[#edits + 1] = { s2, e2, "<w:tcPr>" .. cell_props(props, colour) .. "</w:tcPr>" }
            else
              edits[#edits + 1] = { start, start, "<w:tcPr>" .. cell_props("", colour) .. "</w:tcPr>" }
            end
          end
        end
      end
    end
  end
  table.sort(edits, function(a, b) return a[1] > b[1] end)
  for _, edit in ipairs(edits) do
    xml = xml:sub(1, edit[1] - 1) .. edit[3] .. xml:sub(edit[2])
  end
  return xml
end

-- The Word file with the looks added; as written when there are none.
local function with_looks(bytes, looks)
  if not looks then return bytes end
  local ok, result = pcall(function()
    local archive = pandoc.zip.Archive(bytes)
    local styles = ""
    for _, e in ipairs(archive.entries) do
      if e.path == "word/styles.xml" then styles = e:contents() end
    end
    local entries = {}
    for _, e in ipairs(archive.entries) do
      if e.path == "word/document.xml" then
        entries[#entries + 1] = pandoc.zip.Entry(e.path, add_looks(e:contents(), looks, styles), e.modtime)
      else
        entries[#entries + 1] = e
      end
    end
    return pandoc.zip.Archive(entries):bytestring()
  end)
  if ok then return result end
  warn("table colours and lines left out: " .. tostring(result))
  return bytes
end

-- Pandoc's own Word writer: its extensions are this writer's.
Extensions = pandoc.format.extensions("docx")

function ByteStringWriter(doc, opts)
  local out_file = PANDOC_STATE.output_file
  if out_file == nil or out_file == "-" then
    error("docx.lua writes a Word file, so it needs an output file: add -o name.docx", 0)
  end

  local name = doc.meta[KEY] and pandoc.utils.stringify(doc.meta[KEY]) or nil
  -- Not a document property: Pandoc writes unknown metadata into the file.
  doc.meta[KEY] = nil
  local format = { format = "docx", extensions = opts.extensions }
  local looks = table_looks(doc)

  if name == nil or (opts.reference_doc and opts.reference_doc ~= "") then
    return with_looks(pandoc.write(doc, format, opts), looks)
  end
  local _, bytes = pandoc.mediabag.lookup(name)
  if not bytes then
    warn("reference document not found in the media bag; using Pandoc's: " .. name)
    return with_looks(pandoc.write(doc, format, opts), looks)
  end

  return pandoc.system.with_temporary_directory("mdz-docx", function(dir)
    -- Pandoc reads a .dotx as it does a .docx, and writes a .docx either way.
    local path = dir .. "/reference" .. (name:match("%.%w+$") or ".docx")
    local fh = assert(io.open(path, "wb"))
    fh:write(bytes)
    fh:close()
    opts.reference_doc = path
    return with_looks(pandoc.write(doc, format, opts), looks)
  end)
end
