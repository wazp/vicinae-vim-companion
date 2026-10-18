import type { Source } from "../types/commands";

/** Display names for well-known plugins. Anything else falls back to a cleaned-up repo name. */
const PLUGIN_NAMES: Record<string, string> = {
	"telescope.nvim": "Telescope",
	"snacks.nvim": "Snacks",
	"which-key.nvim": "which-key",
	"fzf-lua": "fzf-lua",
	"neo-tree.nvim": "Neo-tree",
	"nvim-tree.lua": "nvim-tree",
	"gitsigns.nvim": "Gitsigns",
	"trouble.nvim": "Trouble",
	"flash.nvim": "Flash",
	"conform.nvim": "Conform",
	"nvim-lspconfig": "LSP",
	"noice.nvim": "Noice",
	"bufferline.nvim": "Bufferline",
	"todo-comments.nvim": "todo-comments",
	"grug-far.nvim": "grug-far",
	"persistence.nvim": "Persistence",
	"nvim-treesitter": "Treesitter",
	"nvim-treesitter-textobjects": "Treesitter textobjects",
	"oil.nvim": "Oil",
	harpoon: "Harpoon",
	"copilot.lua": "Copilot",
	"CopilotChat.nvim": "CopilotChat",
	"mason.nvim": "Mason",
	"nvim-dap": "DAP",
	neotest: "Neotest",
	"yanky.nvim": "Yanky",
	"mini.files": "mini.files",
	"mini.surround": "mini.surround",
	"mini.ai": "mini.ai",
	"vim-fugitive": "Fugitive",
	"vim-surround": "vim-surround",
	"vim-commentary": "vim-commentary",
	nerdtree: "NERDTree",
	"fzf.vim": "fzf.vim",
	LazyVim: "LazyVim",
};

export function prettyPluginName(dirName: string): string {
	if (PLUGIN_NAMES[dirName]) return PLUGIN_NAMES[dirName];
	return dirName.replace(/\.(nvim|vim|lua)$/i, "").replace(/^(nvim|vim)-/i, "");
}

export interface Attribution {
	source: Source;
	sourceName?: string;
	context?: string;
	/** Plugin directory name, when known. */
	plugin?: string;
}

function splitOrigin(origin: string): { path: string; line?: number } {
	const m = /^(.*):(\d+)$/.exec(origin);
	return m ? { path: m[1], line: Number(m[2]) } : { path: origin };
}

function relative(path: string, root: string): string {
	return path.slice(root.length).replace(/^\/+/, "");
}

const MANAGER_DIR =
	/\/(?:pack\/[^/]+\/(?:start|opt)|plugged|bundle|lazy|site\/pack\/[^/]+\/(?:start|opt))\/([^/]+)\//;

export interface AttributionContext {
	configDir?: string;
	runtimeDir?: string;
	lazyRoot?: string;
	editor: "vim" | "neovim";
}

/**
 * Decide where a mapping came from, using only the definition path. Returns
 * a generic "custom" attribution without a name when the evidence is weak.
 */
export function attributeOrigin(
	origin: string | undefined,
	ctx: AttributionContext,
): Attribution {
	const builtin: Source = ctx.editor === "neovim" ? "neovim" : "vim";
	if (!origin)
		return { source: "custom", context: "Definition site not recorded" };
	const { path, line } = splitOrigin(origin);
	const where = (rel: string) => (line ? `${rel}:${line}` : rel);

	if (
		path.startsWith("vim/") ||
		(ctx.runtimeDir && path.startsWith(`${ctx.runtimeDir}/`)) ||
		/\/share\/n?vim\/(runtime|vim\d+)\//.test(path)
	) {
		const rel =
			ctx.runtimeDir && path.startsWith(ctx.runtimeDir)
				? relative(path, ctx.runtimeDir)
				: path;
		const named =
			/pack\/dist\/opt\/([^/]+)\//.exec(rel)?.[1] ??
			/plugin\/(netrw|matchit|matchparen)/.exec(rel)?.[1] ??
			undefined;
		return {
			source: builtin,
			sourceName: named,
			context: `${ctx.editor === "neovim" ? "Neovim" : "Vim"} runtime (${where(rel)})`,
		};
	}
	if (ctx.lazyRoot && path.startsWith(`${ctx.lazyRoot}/`)) {
		const rel = relative(path, ctx.lazyRoot);
		const plugin = rel.split("/")[0];
		if (plugin === "LazyVim")
			return {
				source: "lazyvim",
				sourceName: "LazyVim",
				plugin,
				context: where(rel),
			};
		return {
			source: "plugin",
			sourceName: prettyPluginName(plugin),
			plugin,
			context: where(rel),
		};
	}
	const managed = MANAGER_DIR.exec(path);
	if (managed) {
		const plugin = managed[1];
		if (plugin === "LazyVim")
			return {
				source: "lazyvim",
				sourceName: "LazyVim",
				plugin,
				context: where(path),
			};
		return {
			source: "plugin",
			sourceName: prettyPluginName(plugin),
			plugin,
			context: where(path),
		};
	}
	if (
		ctx.configDir &&
		(path === ctx.configDir || path.startsWith(`${ctx.configDir}/`))
	) {
		return { source: "custom", context: where(relative(path, ctx.configDir)) };
	}
	return { source: "custom", context: where(path) };
}
