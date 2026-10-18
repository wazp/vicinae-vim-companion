# Vim Companion

Search Vim commands and your Neovim keymaps using plain English.

Vim Companion is a [Vicinae](https://github.com/vicinaehq/vicinae) extension: a fast, offline reference for Vim commands, Neovim keymaps, and LazyVim shortcuts. Describe what you want to do ("replace current word", "delete inside brackets", "find files") and get the keystrokes, with an explanation and examples. It also discovers the mappings from your own editor configuration and makes them searchable the same way.

No AI, no network, no API keys.

<!-- Screenshots: replace with real captures before publishing -->
| Search | Detail | Browse keymaps |
|---|---|---|
| `assets/screenshots/search.png` | `assets/screenshots/detail.png` | `assets/screenshots/browse.png` |

## Commands

| Command | What it does |
|---|---|
| **Search Vim Commands** | The main entry point. Type an intent or the keys themselves. Press Enter for details. |
| **Browse Keymaps** | Explore the mappings discovered from your configuration, filtered by status, source/plugin, mode, or editor. |
| **Refresh Keymaps** | Re-detect editors and re-discover mappings (clears the cache). |
| **Environment Diagnostics** | Editors, versions, config paths, LazyVim detection, leader keys, mapping counts, warnings, and limitations. |

Actions on every result: view details, copy keystrokes, copy the leader-expanded keys, copy the explanation, copy an example, refresh keymaps, open diagnostics. Vim Companion never sends keystrokes to an editor.

## Three sources of information

Vim Companion keeps these apart, and every result says which one it came from:

1. **Built-in reference.** About 380 curated entries for standard Vim behavior and Neovim's built-in defaults, written against Vim's documentation. Works with no editor installed. These describe documented behavior, not your configuration.
2. **Runtime mappings.** What your Vim or Neovim actually has mapped after startup, read from the running editor.
3. **LazyVim and plugin mappings.** Mappings attributed to LazyVim or a specific plugin, plus keys that plugins declare but that only appear later (on first use, for a filetype, or when an LSP server attaches).

Each result carries a status:

| Status | Meaning |
|---|---|
| Built-in reference | Documented behavior, not read from your editor |
| Active global mapping | Observed as a global mapping in your editor |
| Buffer-local mapping | Observed only in the buffer that was inspected |
| Plugin-declared mapping | Declared in a lazy.nvim spec, but no mapping was observed |
| Conditional mapping | Only exists in some buffers (a filetype, or an attached LSP server) |
| Overridden | A built-in your configuration remaps in at least one mode |

## Installation

Requires Vicinae. Building and testing require Node.js 22+.

```bash
git clone <this repo> vim-companion
cd vim-companion
npm install
npm run build   # builds and installs into Vicinae's extension directory
```

For development with live reload: `npm run dev`.

## Supported editors

| Editor | Built-in reference | Runtime mappings |
|---|---|---|
| None installed | Yes | No |
| Vim 8/9 | Yes | Yes. `maplist()` on Vim 9.0.1004+, `:verbose map` parsing on older versions |
| Neovim 0.9+ | Yes | Yes |
| LazyVim (on Neovim) | Yes | Yes, with LazyVim attribution, extras, and LSP keymaps |

Linux is the primary target. Nothing in the code is Linux-only: macOS should work (Homebrew paths are searched), but it is untested. Windows is not supported for runtime discovery.

## Preferences

A new user should not need to change anything.

| Preference | Default | Purpose |
|---|---|---|
| Preferred Editor | Auto | Auto, Neovim, or Vim. Auto discovers both and prefers Neovim for ranking. |
| Runtime Discovery | Load my configuration | `config` loads your config (runs its startup code), `safe` shows editor defaults only, `off` uses the built-in reference only. |
| Vim Executable | empty | Absolute path to `vim`. Empty searches PATH. |
| Neovim Executable | empty | Absolute path to `nvim`. Empty searches PATH. |
| Neovim Configuration | empty | An `NVIM_APPNAME` profile (e.g. `lazyvim`) or an absolute config directory. Empty uses your environment. |
| Include built-in commands | on | Search the curated reference. |
| Include custom keymaps | on | Search mappings from your config, LazyVim, and editor defaults. |
| Include plugin mappings | on | Search mappings attributed to plugins. |
| Leader Key | empty | Display override for `<leader>`, e.g. `Space`, `,`, or `\`. Empty uses the detected value. Affects display only. |
| Search Result Limit | 50 | Maximum results while searching. |

## How detection works

- **Executables** are found by walking PATH (no shell, no `which`) plus common install locations that desktop launchers often miss (`~/.local/bin`, `/usr/local/bin`, Nix and Snap paths, `/opt/homebrew/bin` on macOS). A binary only counts as Vim or Neovim if its `--version` output says so.
- **Neovim configuration** is `$XDG_CONFIG_HOME/$NVIM_APPNAME` (defaults `~/.config/nvim`). An absolute directory override is applied by pointing `XDG_CONFIG_HOME` and `NVIM_APPNAME` at it, which is what Neovim itself would do; note that Neovim then uses the matching data directory too.
- **Vim configuration** is the first of `~/.vimrc`, `~/.vim/vimrc`, `$XDG_CONFIG_HOME/vim/vimrc`.
- **LazyVim** is only reported when, after startup, the `LazyVim/LazyVim` spec is registered with lazy.nvim **and** LazyVim's modules are loaded. Using lazy.nvim alone is not LazyVim. A `lazyvim.json` file is shown as a hint in diagnostics but is never treated as proof.

## How keymaps are discovered

### Neovim

Neovim is started headlessly (`nvim --headless -n -i NONE`) with two small Lua scripts:

1. Before your config loads (`--cmd`), a script wraps `nvim_set_keymap` and `nvim_buf_set_keymap` to record **where** each mapping is defined: the first caller outside known wrapper layers (`vim.keymap`, Snacks, lazy.nvim's key handler, which-key, LazyVim's `safe_keymap_set`). The originals are called with identical arguments, so mappings are unchanged.
2. After startup (`-c`), a script fires lazy.nvim's `VeryLazy` event (LazyVim registers most global keymaps there and it never fires without a UI), then reads `nvim_get_keymap()` and `nvim_buf_get_keymap()` for Normal, Visual, Select, Operator-pending, Insert, Command-line, and Terminal mode, `mapleader`/`maplocalleader`, lazy.nvim's plugin specs, and LazyVim's version, extras, and LSP keymaps. It writes one JSON file and quits.

Lua callbacks are **never executed**. Mappings with a `desc` use it; others show their right-hand side or "Lua function (no description)".

Attribution is based only on definition paths: Neovim's runtime, LazyVim, a plugin directory, or your config directory. When the evidence is weak, the mapping is labeled as user configuration with its file and line rather than guessed.

### LazyVim

- lazy.nvim creates stub mappings for lazy-loaded plugins' `keys`. These are active (pressing them loads the plugin) and are attributed to the plugin that declared them.
- Spec keys that have no mapping in the session are listed as **declared**; keys with an `ft` are **conditional**; disabled plugins are skipped.
- LSP keymaps (`gd`, `K`, `<leader>ca`, `<leader>cr`, ...) are read from LazyVim's `nvim-lspconfig` options (`servers["*"].keys` and per-server keys, or the pre-v15 API). They are always **conditional**, with the capability they need, because they only exist after a server attaches.
- `<leader>ff` is listed as `<leader>ff`; the detail view also shows the keys you actually type (`Space f f`) using your real leader. Space is never assumed.
- If you override a LazyVim default, the mapping you see is the effective one, attributed to your config.

### Vim

Vim runs in silent Ex mode (`vim -N -u <vimrc> -i NONE -n -es`), loads plugins and packages as a normal startup would, and dumps `maplist()` with `getscriptinfo()` (Vim 9.0.1004+). Older Vims fall back to parsing `:verbose map` and `:verbose map!` output. No Lua or Neovim is required. Vim has no description field for mappings, so titles come from the right-hand side.

### Caching

Results are cached as versioned JSON in the extension's support directory (never in your editor config). On open, cached mappings show immediately. A stat-only fingerprint of the discovery preferences, the executables, and your config files (`.lua`, `.vim`, `.json`, `.fnl`, including `lazy-lock.json`) decides whether to re-discover in the background, so opening Vim Companion does not launch your editor when nothing changed. Corrupt or old-format caches are discarded and rebuilt. Run **Refresh Keymaps** to force it.

## What cannot be discovered automatically

Discovery is a snapshot of one headless session with one empty scratch buffer. It does not represent that snapshot as complete:

- Mappings created on `FileType`, `BufEnter`, `LspAttach`, or other autocommands are missing unless a plugin spec declares them (lazy.nvim `keys` with `ft`, LazyVim LSP keys). Plain `vim.keymap.set` calls inside an `LspAttach` handler in your own config are not visible.
- Buffer-local mappings are only those of the inspected scratch buffer.
- Mappings created by plugins that are loaded later by an event other than `VeryLazy`, a command, or a filetype may be listed as declared (if lazy.nvim knows the keys) or not at all.
- What a Lua callback does is never inferred; only its `desc` is shown.
- Vimscript mappings created through `execute` in a plugin are attributed to that plugin's file, which is usually right but not always the "real" author.
- Vim mappings have no descriptions.

## How search works

Search is deterministic and runs locally on every keystroke (typically under 2 ms). There are no subprocess calls or network requests while typing. Vicinae's built-in fuzzy filtering is disabled so it cannot drop or reorder results.

1. **Normalization.** Lowercasing, Unicode decomposition (accents are ignored), tokenization, stopword removal ("how do I go to the end of the file" becomes "go end file"), and light stemming ("deleting", "deleted" and "delete" meet).
2. **Synonyms.** True equivalents are folded together on both sides: copy/yank, remove/delete/cut, replace/change, find/search/grep, folder/directory, beginning/start, back/previous, forward/next. Related-but-different concepts get reduced weight instead: "brackets" leans toward parentheses, then braces and square brackets; tab, buffer, and window stay distinct.
3. **Typos and partial words.** Unknown words are corrected against the indexed vocabulary (1 edit for 4-7 letters, 2 for longer; short words are never corrected), and the last word is prefix-completed while you type.
4. **Key notation.** Exact keys (`ciw`, `<C-r>`), alternative notation (`ctrl-r`, `ctrl+w v`, `^R`, `<c-R>`), spelled-out keys (`space f f`, `leader g g`), counts (`3dd`), placeholders (`dt,` finds `dt{char}`), and Ex commands without the colon (`noh`).
5. **Ranking tiers.** Exact keystrokes, then exact title, then exact intent alias, then all-terms matches, partial keyword matches, description matches, and typo matches last. Active mappings from your config get a small boost; Neovim-only defaults are demoted when your editor is Vim; overridden built-ins are demoted.
6. **Command composer.** A small rule-based parser recognizes operator + scope + text object phrases and composes valid Vim commands: "delete inside quotes" gives `di"`, "select around braces" gives `va{`, "copy inside brackets" gives `yi(` (with `yi[` and `yi{` as alternatives). Only whitelisted combinations of the operators `d c y v gU gu g~ > < = gq` with the inner and around word, WORD, sentence, paragraph, quote, backtick, parenthesis, bracket, brace, angle bracket, and tag objects are produced, each explained part by part. It never invents key sequences and exact keystroke matches always rank above it.

### Limits

This is keyword matching with curated phrasing, not language understanding. It works well for the way people usually describe editing actions, and the test suite pins more than 100 such queries to their expected top results. It will not understand long, indirect, or unusual descriptions ("make this function shorter"), negations, or multi-step goals. If a query fails, rephrase it with the action and the thing it acts on ("delete paragraph", "copy to clipboard"), or type the keys.

## Privacy and security

- No telemetry, analytics, network requests, cloud services, or AI. Everything stays on your machine.
- No configuration files are uploaded, copied, or modified. Outside the editor process itself, Vim Companion only reads file metadata (existence, size, modification time) for detection and cache invalidation.
- Subprocesses are started with `execFile`, never through a shell, with a timeout and an output cap. User-supplied paths are passed as arguments, never interpolated into commands.
- **Trust boundary:** in the default "Load my configuration" mode, Vim Companion starts your editor with your configuration, which **executes its startup code** (init files, plugins, autocommands) exactly as opening the editor would. This is not a sandbox. To reduce side effects during discovery, `git`, `curl`, `wget`, `tar`, compilers, and package managers are shadowed on PATH by stubs that fail, lazy.nvim's update checker is disabled, shada and swap files are off, and the editor runs in an extension-owned scratch directory. Plugins are never installed or updated by Vim Companion.
- If you do not want your configuration executed, set **Runtime Discovery** to **Safe** (editor defaults only) or **Off** (built-in reference only).

## Troubleshooting

Open **Environment Diagnostics** first: it shows what was detected, where, and the editor's own error output.

| Symptom | Fix |
|---|---|
| "No Vim or Neovim installation found" | Set the executable path in preferences. Launchers can have a smaller PATH than your shell. |
| Discovery failed or timed out | Run `nvim --headless +qa` in a terminal: if it prompts or errors, discovery will too. Plugins that wait for input on first install are the usual cause. Install plugins once interactively, then **Refresh Keymaps**. |
| LazyVim not detected | Check the selected configuration in diagnostics, and set **Neovim Configuration** if you use `NVIM_APPNAME`. |
| A mapping is missing | It may be created on a filetype or LSP attach. See [What cannot be discovered](#what-cannot-be-discovered-automatically). |
| Leader shows the wrong key | Set the **Leader Key** display override. |
| Results look stale | Run **Refresh Keymaps**. |

## Development

```bash
npm install
npm run dev         # live development in Vicinae
npm test            # unit, fixture, and pipeline tests (node:test via tsx)
npm run typecheck   # tsc for src and tests
npm run lint        # validate the manifest
npm run format      # biome
npm run build       # production build
```

Integration tests run against real editors when installed. Neovim is exercised in safe mode by default; to also run discovery against your own configuration (which executes it), set `VIM_COMPANION_TEST_USER_CONFIG=1`.

```text
src/
  search-commands.tsx, browse-keymaps.tsx, refresh-keymaps.ts, environment-diagnostics.tsx   command entry points
  components/        list item, detail view, actions, diagnostics view
  hooks/             useKeymaps: cache-first loading and background refresh
  data/vim/          curated reference database, one file per area
  search/            normalization, synonyms, fuzzy matching, ranking, composer
  discovery/         environment detection, Neovim/LazyVim/Vim discovery, embedded editor scripts
  services/          cache, refresh orchestration, catalog merging, diagnostics, preferences
  types/, utils/     shared model, settings, key notation, paths, subprocess
tests/
  search/, data/, utils/, discovery/, services/, fixtures/
```

Vicinae requires command entry points at `src/<command-name>.tsx`, so commands live at the top of `src/` rather than in a `commands/` folder.

Adding reference entries: add to the relevant file in `src/data/vim/`, give it plain-English `aliases` people would actually type, then add a ranking case to `tests/search/queries.test.ts`.

## Known limitations

- Runtime discovery is a startup snapshot (see above).
- Vim runtime discovery is covered by fixture and pipeline tests but has not been run against a real Vim installation by the author.
- macOS is untested; Windows runtime discovery is not supported.
- The reference database is English only.
- Composed commands cover operator + text object grammar only. Other operations come from the curated reference.

## License

MIT
