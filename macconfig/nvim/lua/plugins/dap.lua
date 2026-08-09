local dap_plugins = {
	"https://github.com/nvim-neotest/nvim-nio",
	"https://github.com/rcarriga/nvim-dap-ui",
	"https://github.com/mfussenegger/nvim-dap",
	{
		src = "https://github.com/ronakpjain/cortex.nvim",
		name = "cortex.nvim",
	},
}

vim.pack.add(dap_plugins, { confirm = false, load = true })

local dap = require("dap")
local cortex = require("cortex")
cortex.setup({
	rtos = {
		enabled = true,
		auto_open = true,
		auto_refresh_on_stop = true,
	},
	callstack = {
		auto_open = true,
		auto_refresh_on_stop = true,
	},
})

dap.adapters["lldb-dap"] = {
	type = "executable",
	command = vim.fn.exepath("lldb-dap"),
}

dap.configurations.cpp = {
	{
		name = "Launch File",
		type = "lldb-dap",
		request = "launch",
		program = function()
			return vim.fn.input("Path to executable: ", vim.fn.getcwd() .. "/", "file")
		end,
		cwd = "${workspaceFolder}",
		args = function()
			local input = vim.fn.input("Arguments: ")
			return vim.fn.split(input, " ", true)
		end,
		stopOnEntry = false,
	},
}

dap.configurations.c = dap.configurations.cpp

dap.adapters.python = {
	type = "executable",
	command = vim.fn.getenv("VIRTUAL_ENV") and (vim.fn.getenv("VIRTUAL_ENV") .. "/bin/python")
		or vim.fn.exepath("python3"),
	args = { "-m", "debugpy.adapter" },
}

dap.configurations.python = {
	{
		type = "python",
		request = "launch",
		name = "Launch Python File",
		program = "${file}",
		pythonPath = function()
			local venv = os.getenv("VIRTUAL_ENV")
			if venv then
				return venv .. "/bin/python"
			end

			return vim.fn.exepath("python3") or "python3"
		end,
	},
}

-- Keep DAP breakpoints visually distinct from ordinary signs.
vim.api.nvim_set_hl(0, "DapBreakpoint", { fg = "#f7768e" })
vim.api.nvim_set_hl(0, "DapBreakpointCondition", { fg = "#f7768e" })
vim.api.nvim_set_hl(0, "DapBreakpointRejected", { fg = "#f7768e" })
for _, name in ipairs({ "DapBreakpoint", "DapBreakpointCondition", "DapBreakpointRejected" }) do
	vim.fn.sign_define(name, { text = "●", texthl = name, linehl = "", numhl = "" })
end

local dapui = require("dapui")
-- Replace the generic stacks pane (which is mostly the GDB "Remote target")
-- with Cortex's current-thread stack, and put RTOS + REPL/console together
-- in the bottom tray. Live Watch remains its own right-hand window.
dapui.register_element("cortex_callstack", cortex.callstack_element())
dapui.register_element("cortex_rtos", cortex.rtos_element())
dapui.register_element("cortex_peripherals", cortex.peripheral_element())
dapui.setup({
	layouts = {
		{
			elements = {
				{ id = "scopes", size = 0.24 },
				{ id = "breakpoints", size = 0.16 },
				{ id = "cortex_callstack", size = 0.30 },
				{ id = "cortex_peripherals", size = 0.30 },
			},
			size = 42,
			position = "left",
		},
		{
			elements = {
				{ id = "cortex_rtos", size = 0.60 },
				{ id = "repl", size = 0.20 },
				{ id = "console", size = 0.20 },
			},
			size = 14,
			position = "bottom",
		},
	},
})

-- Explicitly focus DAP-UI panes on a mouse click. This complements the
-- element-specific click actions supplied by cortex.nvim.
local dapui_mouse_group = vim.api.nvim_create_augroup("CortexDapUiMouse", { clear = true })
vim.api.nvim_create_autocmd("FileType", {
	group = dapui_mouse_group,
	pattern = { "dapui_*", "dap-repl" },
	callback = function(args)
		vim.keymap.set("n", "<LeftMouse>", function()
			local position = vim.fn.getmousepos()
			local winid = tonumber(position.winid)
			if winid and winid > 0 and vim.api.nvim_win_is_valid(winid) then
				vim.api.nvim_set_current_win(winid)
				local line = tonumber(position.line)
				if line and line > 0 then
					pcall(vim.api.nvim_win_set_cursor, winid, { line, math.max(0, (tonumber(position.column) or 1) - 1) })
				end
			end
		end, { buffer = args.buf, nowait = true, silent = true })
	end,
})

-- nvim-dap-ui has no close event. Wrap its public lifecycle functions so
-- Cortex windows follow the UI when it is closed manually as well as when a
-- session terminates. No dap-ui fork is required.
local dapui_open = false
local dapui_open_raw = dapui.open
local dapui_close_raw = dapui.close
local dapui_toggle_raw = dapui.toggle

dapui.open = function(args)
	dapui_open = true
	return dapui_open_raw(args)
end

dapui.close = function(args)
	local result = dapui_close_raw(args)
	dapui_open = false
	cortex.close_views()
	return result
end

dapui.toggle = function(args)
	local was_open = dapui_open
	local result = dapui_toggle_raw(args)
	if was_open then
		dapui_open = false
		cortex.close_views()
	else
		dapui_open = true
	end
	return result
end

dap.listeners.after.event_initialized["dapui_config"] = function()
	dapui.open()
end
dap.listeners.before.event_terminated["dapui_config"] = function()
	dapui.close()
end
dap.listeners.before.event_exited["dapui_config"] = function()
	dapui.close()
end
