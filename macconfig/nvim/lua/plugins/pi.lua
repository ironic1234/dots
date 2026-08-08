vim.pack.add({ "https://github.com/pablopunk/pi.nvim" }, { confirm = false, load = true })

local pi = require("pi")
local pi_config = require("pi.config")

pi.setup()

local THINKING_LEVELS = { "off", "minimal", "low", "medium", "high", "xhigh" }
local FIDGET_KEY = "pi.nvim.config"

local function notify(message, level)
	local ok, fidget = pcall(require, "fidget")
	if ok and fidget.notify then
		fidget.notify(message, level or vim.log.levels.INFO, { key = FIDGET_KEY, ttl = 5 })
	else
		vim.notify(message, level or vim.log.levels.INFO)
	end
end

local function update_config(changes)
	local opts = vim.deepcopy(pi_config.get())
	for key, value in pairs(changes) do
		opts[key] = value
	end
	pi.setup(opts)
	return pi_config.get()
end

local function format_model(config)
	if config.provider and config.model then
		return config.provider .. "/" .. config.model
	end
	return config.model or "pi default"
end

local function show_config()
	local config = pi_config.get()
	notify(string.format("pi.nvim | model: %s | thinking: %s", format_model(config), config.thinking))
end

-- Resolve pi's scoped model list (`enabledModels` in settings.json, same rules
-- pi itself uses) so cycling in Neovim follows the same order as the pi CLI.

local function agent_dir()
	local override = vim.env.PI_CODING_AGENT_DIR
	if override and override ~= "" then
		return vim.fn.expand(override)
	end
	return vim.fn.expand("~/.pi/agent")
end

local function enabled_model_patterns()
	local path = agent_dir() .. "/settings.json"
	if vim.fn.filereadable(path) ~= 1 then
		return {}
	end
	local ok, settings = pcall(vim.json.decode, table.concat(vim.fn.readfile(path), "\n"))
	if not ok or type(settings) ~= "table" or type(settings.enabledModels) ~= "table" then
		return {}
	end
	return settings.enabledModels
end

local function glob_to_pattern(glob)
	local pattern = glob:gsub("[%^%$%(%)%%%.%[%]%+%-]", "%%%0")
	pattern = pattern:gsub("%*", ".*"):gsub("%?", ".")
	return "^" .. pattern .. "$"
end

local function split_thinking_suffix(pattern)
	local base, suffix = pattern:match("^(.*):([^:]+)$")
	if base and vim.tbl_contains(THINKING_LEVELS, suffix) then
		return base, suffix
	end
	return pattern, nil
end

local function pi_command(extra_args)
	local binary = pi_config.get().binary or "pi"
	local command = type(binary) == "table" and vim.deepcopy(binary) or { binary }
	for index, part in ipairs(command) do
		command[index] = vim.fn.expand(part)
	end
	return vim.list_extend(command, extra_args)
end

local function parse_models(output)
	local models = {}
	for _, line in ipairs(vim.split(output or "", "\n", { plain = true, trimempty = true })) do
		local provider, id, _, _, thinking = line:match("^%s*(%S+)%s+(%S+)%s+(%S+)%s+(%S+)%s+(%S+)")
		if provider and id and provider ~= "provider" then
			models[#models + 1] = {
				provider = provider,
				id = id,
				label = provider .. "/" .. id,
				supports_thinking = thinking == "yes",
			}
		end
	end
	return models
end

local function scope_models(models)
	local patterns = enabled_model_patterns()
	if #patterns == 0 then
		return models
	end

	local scoped, seen = {}, {}
	for _, raw_pattern in ipairs(patterns) do
		local pattern, thinking = split_thinking_suffix(raw_pattern)
		local lua_pattern = glob_to_pattern(pattern:lower())
		for _, model in ipairs(models) do
			local matches = model.label:lower():match(lua_pattern) or model.id:lower():match(lua_pattern)
			if matches and not seen[model.label] then
				seen[model.label] = true
				scoped[#scoped + 1] = vim.tbl_extend("force", model, { thinking = thinking })
			end
		end
	end

	return #scoped > 0 and scoped or models
end

local models_cache = nil
local models_loading = false

local function with_scoped_models(callback)
	if models_cache then
		callback(models_cache)
		return
	end
	if models_loading then
		return
	end

	models_loading = true
	notify("pi.nvim | loading models…")
	vim.system(pi_command({ "--no-approve", "--list-models" }), { text = true }, function(result)
		vim.schedule(function()
			models_loading = false
			if result.code ~= 0 then
				local reason = result.stderr
				if not reason or reason == "" then
					reason = "exit code " .. tostring(result.code)
				end
				notify("pi.nvim | unable to list models: " .. reason, vim.log.levels.ERROR)
				return
			end

			local models = scope_models(parse_models(result.stdout))
			if #models == 0 then
				notify("pi.nvim | no models available", vim.log.levels.WARN)
				return
			end

			models_cache = models
			callback(models)
		end)
	end)
end

local function cycle_model(direction)
	with_scoped_models(function(models)
		if #models < 2 then
			notify("pi.nvim | only one model in scope", vim.log.levels.WARN)
			return
		end

		local current = format_model(pi_config.get())
		local index = 0
		for position, model in ipairs(models) do
			if model.label == current then
				index = position
				break
			end
		end

		local next_index
		if direction == "backward" then
			next_index = (index - 2) % #models + 1
		else
			next_index = index % #models + 1
		end

		local next_model = models[next_index]
		local changes = { provider = next_model.provider, model = next_model.id }
		if not next_model.supports_thinking then
			changes.thinking = "off"
		elseif next_model.thinking then
			changes.thinking = next_model.thinking
		end

		update_config(changes)
		show_config()
	end)
end

local function cycle_thinking()
	local config = pi_config.get()
	local current_index = 1
	for index, level in ipairs(THINKING_LEVELS) do
		if level == config.thinking then
			current_index = index
			break
		end
	end

	local next_index = current_index % #THINKING_LEVELS + 1
	update_config({ thinking = THINKING_LEVELS[next_index] })
	show_config()
end

vim.api.nvim_create_user_command("PiModelsRefresh", function()
	models_cache = nil
	with_scoped_models(function(models)
		notify(string.format("pi.nvim | %d models in scope", #models))
	end)
end, { desc = "pi.nvim: Refresh cached model scope" })

vim.keymap.set("n", "<C-CR>", function()
	cycle_model("forward")
end, { desc = "pi.nvim: Cycle model forward (Ctrl-M)" })

vim.keymap.set("n", "<C-S-CR>", function()
	cycle_model("backward")
end, { desc = "pi.nvim: Cycle model backward (Ctrl-Shift-M)" })

vim.keymap.set("n", "<C-N>", cycle_thinking, { desc = "pi.nvim: Cycle thinking level" })
