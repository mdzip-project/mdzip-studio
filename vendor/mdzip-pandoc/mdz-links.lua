--[[
mdz-links.lua: a Pandoc Lua filter for sites built from .mdz pages.

In HTML output, a link to another .mdz becomes a link to the page made from
it: guide.mdz -> guide.html, ../docs/setup.mdz#install -> ../docs/setup.html#install.
Links to web addresses, and links in other output formats, are left alone.

  pandoc -f mdz.lua --lua-filter mdz-links.lua index.mdz -s -o index.html

The GitHub Action applies it whenever it reads an .mdz.
]]

function Link(el)
  if not FORMAT:match('html') then return nil end
  local target = el.target
  -- Leave web addresses (https:, mailto: ...) and protocol-relative links alone.
  if target:match('^%a[%w+.-]*:') or target:match('^//') then return nil end
  local path, rest = target:match('^([^?#]*)(.*)$')
  if path:lower():match('%.mdz$') then
    el.target = path:sub(1, -5) .. '.html' .. rest
    return el
  end
end
