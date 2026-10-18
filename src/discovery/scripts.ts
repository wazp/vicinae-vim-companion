/**
 * Scripts executed inside a headless editor during discovery. Embedded as
 * strings because the extension is bundled into a single file.
 *
 * They only read state and write one JSON file whose path is passed in the
 * VIM_COMPANION_OUT environment variable. They never call mapping callbacks.
 */

/**
 * Loaded with --cmd, before the user's init file. Wraps the keymap-setting
 * API functions to record *where* each mapping is defined (file:line of the
 * first caller outside known wrapper layers). The wrapped functions call the
 * originals with identical arguments, so mappings are unchanged.
 *
 * It also stubs lazy.nvim's background update checker so discovery never
 * triggers a network fetch.
 */
export const NVIM_PRE_SCRIPT = `
local records = {}
_G.__vim_companion = { records = records }

package.preload["lazy.manage.checker"] = function()
  return setmetatable({}, { __index = function() return function() end end })
end

local SKIP = {
  "vim/keymap.lua",
  "/snacks.nvim/lua/snacks/keymap.lua",
  "/lazy.nvim/lua/lazy/core/handler/",
  "/which-key.nvim/lua/which-key/",
  "/lazyvim/plugins/lsp/keymaps.lua",
  "/lazyvim/util/init.lua",
}

local SELF = debug.getinfo(1, "S").source

local function origin()
  local via_lazy = false
  for level = 2, 40 do
    local info = debug.getinfo(level, "Sl")
    if not info then break end
    local src = info.source or ""
    if src ~= SELF and src:sub(1, 1) == "@" then
      local path = src:sub(2)
      local skipped = false
      for _, pat in ipairs(SKIP) do
        if path:find(pat, 1, true) then
          skipped = true
          if pat:find("lazy.nvim", 1, true) then via_lazy = true end
          break
        end
      end
      if not skipped then return path .. ":" .. tostring(info.currentline or 0), via_lazy end
    end
  end
  return nil, via_lazy
end

local function normalize(lhs)
  local ok, res = pcall(function()
    return vim.fn.keytrans(vim.api.nvim_replace_termcodes(lhs, true, true, true))
  end)
  return ok and res or lhs
end

local function record(mode, lhs, buffer)
  local where, via_lazy = origin()
  records[#records + 1] = { mode = mode, lhs = normalize(lhs), buffer = buffer, origin = where, lazy = via_lazy }
end

local api = vim.api
local set, buf_set = api.nvim_set_keymap, api.nvim_buf_set_keymap
api.nvim_set_keymap = function(mode, lhs, rhs, opts)
  pcall(record, mode, lhs, 0)
  return set(mode, lhs, rhs, opts)
end
api.nvim_buf_set_keymap = function(buf, mode, lhs, rhs, opts)
  pcall(record, mode, lhs, buf)
  return buf_set(buf, mode, lhs, rhs, opts)
end
`;

/** Run with -c after startup. Collects mappings and lazy.nvim/LazyVim metadata. */
export const NVIM_MAIN_SCRIPT = String.raw`
local out_path = vim.env.VIM_COMPANION_OUT
local result = { errors = {}, maps = {}, modes = { "n", "x", "s", "o", "i", "c", "t" } }

local function try(label, fn)
  local ok, err = xpcall(fn, debug.traceback)
  if not ok then result.errors[#result.errors + 1] = label .. ": " .. tostring(err):sub(1, 400) end
end

local function str(v) if type(v) == "string" then return v end return nil end

try("environment", function()
  local v = vim.version()
  result.version = string.format("%d.%d.%d", v.major, v.minor, v.patch)
  result.leader = str(vim.g.mapleader)
  result.localleader = str(vim.g.maplocalleader)
  result.config = vim.fn.stdpath("config")
  result.vimruntime = vim.env.VIMRUNTIME
  result.appname = vim.env.NVIM_APPNAME
  result.instrumented = _G.__vim_companion ~= nil
end)

-- Distributions such as LazyVim define most global keymaps on the VeryLazy
-- event, which only fires after a UI attaches. Fire it so they are registered.
try("verylazy", function()
  if package.loaded["lazy"] then
    vim.api.nvim_exec_autocmds("User", { pattern = "VeryLazy", modeline = false })
    vim.wait(200, function() return false end)
  end
end)

-- Same normalization as the pre script, so recorded and listed keys join.
local function match_key(lhs)
  local ok, res = pcall(function()
    return vim.fn.keytrans(vim.api.nvim_replace_termcodes(lhs, true, true, true))
  end)
  return ok and res or lhs
end

local origins = {}
try("origins", function()
  local recs = (_G.__vim_companion or {}).records or {}
  for _, r in ipairs(recs) do
    local modes = r.mode == "" and { "n", "x", "s", "o" } or (r.mode == "v" and { "x", "s" }) or (r.mode == "!" and { "i", "c" }) or { r.mode }
    for _, m in ipairs(modes) do origins[m .. "\1" .. r.lhs] = r end
  end
end)

local function script_name(sid)
  if not sid or sid <= 0 then return nil end
  local ok, info = pcall(vim.fn.getscriptinfo, { sid = sid })
  if ok and info and info[1] then return info[1].name end
  return nil
end

local function collect(mode, maps, buffer)
  for _, m in ipairs(maps) do
    local entry = {
      mode = mode,
      lhs = m.lhs,
      norm = (function()
        local ok, r = pcall(vim.fn.keytrans, m.lhsraw or m.lhs)
        return ok and r or m.lhs
      end)(),
      match = match_key(m.lhs),
      rhs = str(m.rhs),
      desc = str(m.desc),
      callback = m.callback ~= nil,
      expr = m.expr == 1,
      noremap = m.noremap == 1,
      buffer = buffer,
      sid = m.sid,
    }
    local rec = origins[mode .. "\1" .. entry.match]
    if rec then
      entry.origin = rec.origin
      entry.via_lazy = rec.lazy
    end
    if not entry.origin then
      local name = script_name(m.sid)
      if name then entry.origin = name .. ":" .. tostring(m.lnum or 0) end
    end
    if not entry.origin and m.callback then
      local info = debug.getinfo(m.callback, "S")
      if info and info.source and info.source:sub(1, 1) == "@" then
        entry.origin = info.source:sub(2) .. ":" .. tostring(info.linedefined or 0)
      end
    end
    result.maps[#result.maps + 1] = entry
  end
end

try("keymaps", function()
  for _, mode in ipairs(result.modes) do
    collect(mode, vim.api.nvim_get_keymap(mode), false)
    collect(mode, vim.api.nvim_buf_get_keymap(0, mode), true)
  end
end)

try("lazy", function()
  local ok, Config = pcall(require, "lazy.core.config")
  if not ok or type(Config.plugins) ~= "table" then return end
  local lazy = { root = Config.options and Config.options.root, plugins = {} }
  local Keys = package.loaded["lazy.core.handler.keys"] or require("lazy.core.handler.keys")
  local Plugin = require("lazy.core.plugin")
  for name, plugin in pairs(Config.plugins) do
    local p = { name = name, loaded = plugin._ and plugin._.loaded ~= nil, lazy = plugin.lazy == true, dir = plugin.dir, keys = {} }
    local ok_keys, specs = pcall(Plugin.values, plugin, "keys", true)
    if ok_keys and type(specs) == "table" then
      local ok_res, resolved = pcall(Keys.resolve, specs)
      if ok_res then
        for _, k in pairs(resolved) do
          if k.lhs and k.lhs ~= "" then
            local modes = type(k.mode) == "table" and k.mode or { k.mode or "n" }
            p.keys[#p.keys + 1] = {
              lhs = k.lhs,
              match = match_key(k.lhs),
              modes = modes,
              desc = str(k.desc),
              ft = k.ft,
              rhs = str(k.rhs),
            }
          end
        end
      end
    end
    lazy.plugins[#lazy.plugins + 1] = p
  end
  lazy.disabled = {}
  for name in pairs((Config.spec and Config.spec.disabled) or {}) do lazy.disabled[#lazy.disabled + 1] = name end
  result.lazy = lazy
end)

try("lazyvim", function()
  local ok_cfg, Config = pcall(require, "lazy.core.config")
  local has_spec = ok_cfg and Config.spec and Config.spec.plugins and Config.spec.plugins["LazyVim"] ~= nil
  local mod = package.loaded["lazyvim.config"]
  if not (has_spec and mod) then return end
  local lv = { version = str(mod.version), extras = {} }
  local ok_json, json = pcall(function() return mod.json and mod.json.data and mod.json.data.extras end)
  if ok_json and type(json) == "table" then
    for _, e in ipairs(json) do lv.extras[#lv.extras + 1] = e end
  end
  if ok_cfg and Config.spec and type(Config.spec.modules) == "table" then
    for _, m in ipairs(Config.spec.modules) do
      if type(m) == "string" and m:find("^lazyvim%.plugins%.extras%.") and not vim.tbl_contains(lv.extras, m) then
        lv.extras[#lv.extras + 1] = m
      end
    end
  end
  -- LSP keymaps are buffer-local and only set when a server attaches.
  lv.lsp_keys = {}
  local function add_keys(server, specs)
    if type(specs) ~= "table" then return end
    local ok_res, resolved = pcall(require("lazy.core.handler.keys").resolve, specs)
    if not ok_res then return end
    for _, k in pairs(resolved) do
      if k.lhs and k.lhs ~= "" then
        local has = k.has
        if type(has) == "string" then has = { has } end
        lv.lsp_keys[#lv.lsp_keys + 1] = {
          lhs = k.lhs,
          modes = type(k.mode) == "table" and k.mode or { k.mode or "n" },
          desc = str(k.desc),
          has = has,
          server = server,
        }
      end
    end
  end
  local okk, keymaps = pcall(require, "lazyvim.plugins.lsp.keymaps")
  if okk and keymaps._keys == nil and type(keymaps.get) == "function" then
    -- LazyVim < 15 builds the list on demand.
    local ok_get, specs = pcall(keymaps.get)
    if ok_get then add_keys("*", specs) end
  else
    local ok_opts, opts = pcall(function()
      return require("lazy.core.plugin").values(Config.spec.plugins["nvim-lspconfig"], "opts", false)
    end)
    if ok_opts and type(opts) == "table" and type(opts.servers) == "table" then
      for server, sopts in pairs(opts.servers) do
        if type(sopts) == "table" and sopts.enabled ~= false then add_keys(server, sopts.keys) end
      end
    end
  end
  result.lazyvim = lv
end)

local f = out_path and io.open(out_path, "w")
if f then
  local ok, encoded = pcall(vim.json.encode, result)
  f:write(ok and encoded or vim.json.encode({ errors = { "encode: " .. tostring(encoded) } }))
  f:close()
end
vim.cmd("qa!")
`;

/**
 * Vim (not Neovim) extraction. Uses maplist() (Vim 9.0.1004+) when present
 * and otherwise captures ":verbose map" text for the TypeScript parser.
 */
export const VIM_SCRIPT = String.raw`
let s:out = $VIM_COMPANION_OUT
let s:result = {'version': v:version, 'leader': get(g:, 'mapleader', v:null), 'localleader': get(g:, 'maplocalleader', v:null), 'errors': []}
let s:result.myvimrc = $MYVIMRC
let s:result.vimruntime = $VIMRUNTIME
try
  if exists('*maplist')
    let s:result.maps = maplist()
    let s:result.scripts = exists('*getscriptinfo') ? map(getscriptinfo(), {_, v -> {'sid': v.sid, 'name': v.name}}) : []
  else
    let s:result.text = execute('verbose map') . "\n" . execute('verbose map!')
  endif
catch
  call add(s:result.errors, v:exception)
endtry
call writefile([json_encode(s:result)], s:out)
qa!
`;
