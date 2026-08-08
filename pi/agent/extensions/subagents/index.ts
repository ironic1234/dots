/**
 * Subagents — robust subagent orchestration for pi.
 *
 * Lets the orchestrator (the main agent) spin up, monitor, and prompt
 * subagents of ARBITRARY models, each with its OWN isolated context window.
 *
 * Capabilities:
 *   - Single / parallel / chain modes
 *   - Arbitrary model per task: `model: "provider/id"` (validated against the
 *     model registry before running; clear errors for unknown models)
 *   - Inline agents: `systemPrompt` + `model` + `tools` without agent files
 *   - Agent files: `<agentDir>/agents/*.md` (user) and `.pi/agents/*.md`
 *     (project, opt-in), with model/tools/thinking/timeout/maxTurns frontmatter
 *   - Own context window per subagent: each subagent is an in-process Agent
 *     with its own transcript — no extra pi processes are spawned
 *   - Multi-turn prompting: `keepSession: true` returns a sessionId; passing
 *     that `sessionId` later continues the SAME context window (memory)
 *   - Watchdogs: per-task timeout and maxTurns abort the subagent
 *   - Abort propagation from the parent agent's signal
 *   - Monitoring: run records persisted via pi.appendEntry; `/subagents`
 *     command lists active/recent runs with usage; streaming TUI updates
 *   - Output caps so subagent results never flood the orchestrator's context
 */

import { randomUUID } from "node:crypto";
import { StringEnum } from "@earendil-works/pi-ai";
import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { type AgentScope, discoverAgents, formatAgentList } from "./agents.ts";
import {
	type SubagentRunResult,
	type SubagentTaskSpec,
	type RunnerEvent,
	accumulateUsage,
	emptyUsage,
	getFinalOutput,
	runSubagent,
} from "./runner.ts";
import {
	formatTokens,
	isFailedResult,
	liveDashboardText,
	preview,
	renderLiveDashboard,
	renderRunResults,
	statusIcon,
	truncateBytes,
	usageLine,
	SubagentsBrowser,
	type LiveRun,
} from "./ui.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONCURRENCY = 1; // sequential by default
const MAX_PARALLEL_TASKS = 8;
const PARENT_OUTPUT_CAP = 50 * 1024; // per-task cap for text returned to the parent LLM
const RUN_ENTRY_TYPE = "subagent-run";
const RUN_DETAIL_ENTRY_TYPE = "subagent-run-detail";
const UPDATE_THROTTLE_MS = 200;
// Caps for the persisted per-run transcript (browsable via /subagents after the fact).
const MESSAGE_TEXT_CAP = 4000;
const MESSAGE_RESULT_CAP = 2000;
const MAX_STORED_ACTIVITIES = 200;

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

const ThinkingLevelSchema = StringEnum(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const, {
	description:
		"Reasoning level for the subagent model. Default: off (cheap & fast). Raise to low/high for harder tasks that benefit from reasoning; not all models support every level.",
});

const TaskItem = Type.Object({
	agent: Type.Optional(Type.String({ description: "Agent definition name (from agents/)" })),
	task: Type.String({ description: "Task text to delegate. Use {previous} in chain mode for prior step output." }),
	model: Type.Optional(Type.String({ description: 'Arbitrary model: "provider/id", "provider/*", or bare id' })),
	systemPrompt: Type.Optional(Type.String({ description: "Inline system prompt (overrides agent file prompt)" })),
	tools: Type.Optional(Type.Array(Type.String(), { description: "Tool allowlist for this subagent" })),
	thinking: Type.Optional(ThinkingLevelSchema),
	timeoutSec: Type.Optional(Type.Number({ description: "Kill the subagent after this many seconds" })),
	maxTurns: Type.Optional(Type.Number({ description: "Kill the subagent after this many assistant turns" })),
	cwd: Type.Optional(Type.String({ description: "Working directory for the subagent" })),
	sessionId: Type.Optional(Type.String({ description: "Continue an existing subagent context window (from keepSession)" })),
	keepSession: Type.Optional(Type.Boolean({ description: "Save the session so it can be continued later" })),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description: 'Agent scope. "user" (default) loads <agentDir>/agents. "project" loads .pi/agents. "both" loads both.',
});

const SubagentParams = Type.Object({
	agent: Type.Optional(Type.String({ description: "Agent definition name (single mode)" })),
	task: Type.Optional(Type.String({ description: "Task text (single mode)" })),
	model: Type.Optional(Type.String({ description: 'Arbitrary model: "provider/id", "provider/*", or bare id (single mode)' })),
	systemPrompt: Type.Optional(Type.String({ description: "Inline system prompt (single mode, overrides agent prompt)" })),
	tools: Type.Optional(Type.Array(Type.String(), { description: "Tool allowlist (single mode)" })),
	thinking: Type.Optional(ThinkingLevelSchema),
	timeoutSec: Type.Optional(Type.Number({ description: "Kill after this many seconds (single mode)" })),
	maxTurns: Type.Optional(Type.Number({ description: "Kill after this many assistant turns (single mode)" })),
	cwd: Type.Optional(Type.String({ description: "Working directory for the subagent" })),
	sessionId: Type.Optional(Type.String({ description: "Continue an existing subagent context window" })),
	keepSession: Type.Optional(Type.Boolean({ description: "Save the session so it can be continued later" })),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Parallel mode: array of tasks to run concurrently" })),
	chain: Type.Optional(Type.Array(TaskItem, { description: "Chain mode: sequential steps, {previous} = prior step output" })),
	agentScope: Type.Optional(AgentScopeSchema),
	parallelLimit: Type.Optional(Type.Number({ description: "Max concurrent subagents (default 1 = sequential; parallel subagents interleave on the same event loop)" })),
});

type TaskItemType = Static<typeof TaskItem>;

interface ResolvedTask extends SubagentTaskSpec {
	agentSource?: string;
}

interface RunRecord {
	runId: string;
	groupId: string;
	kind: "single" | "parallel" | "chain";
	name: string;
	model: string;
	task: string;
	step?: number;
	status: "running" | "ok" | "error";
	exitCode: number;
	stopReason?: string;
	errorMessage?: string;
	usage: { input: number; output: number; cost: number; turns: number; contextTokens: number };
	sessionId?: string;
	startedAt: string;
	durationMs?: number;
}

// ---------------------------------------------------------------------------
// Model resolution & validation
// ---------------------------------------------------------------------------

interface ResolvedModel {
	modelId: string; // "provider/id" for --model
	provider: string;
	id: string;
	name: string;
	contextWindow: number;
	maxTokens: number;
}

function matchesPattern(model: { provider: string; id: string; name: string }, pattern: string): boolean {
	const p = pattern.trim();
	if (!p) return false;
	if (p.includes("/")) {
		const [providerPart, idPart] = p.split("/", 2);
		const providerOk = providerPart === "*" || model.provider === providerPart;
		if (!providerOk) return false;
		if (idPart === "*") return true;
		return model.id === idPart || model.name === idPart;
	}
	return model.id === p || model.name === p || `${model.provider}/${model.id}` === p;
}

// Resolve a model request against the session's model registry.
// Exported for testing.
export function resolveModel(
	requested: string | undefined,
	ctx: Pick<ExtensionContext, "model"> & { modelRegistry: { getAvailable(): { provider: string; id: string; name: string; contextWindow: number; maxTokens: number }[] } },
): { ok: true; model: ResolvedModel } | { ok: false; error: string; suggestions: string[] } {
	const available = ctx.modelRegistry.getAvailable();

	if (!requested) {
		const current = ctx.model;
		if (current) {
			return {
				ok: true,
				model: {
					modelId: `${current.provider}/${current.id}`,
					provider: current.provider,
					id: current.id,
					name: current.name,
					contextWindow: current.contextWindow,
					maxTokens: current.maxTokens,
				},
			};
		}
		return { ok: false, error: "No model specified and no active model available.", suggestions: [] };
	}

	const normalized = requested.trim();
	const matches = available.filter((m) => matchesPattern(m as never, normalized));

	if (matches.length > 0) {
		// Prefer exact provider/id match.
		const exact = matches.find((m) => `${m.provider}/${m.id}` === normalized) ?? matches[0];
		return {
			ok: true,
			model: {
				modelId: `${exact.provider}/${exact.id}`,
				provider: exact.provider,
				id: exact.id,
				name: exact.name,
				contextWindow: exact.contextWindow,
				maxTokens: exact.maxTokens,
			},
		};
	}

	// Fuzzy suggestions for a helpful error.
	const lower = normalized.toLowerCase();
	const suggestions = available
		.filter((m) => `${m.provider}/${m.id}`.toLowerCase().includes(lower) || m.name.toLowerCase().includes(lower))
		.slice(0, 5)
		.map((m) => `${m.provider}/${m.id}`);

	return {
		ok: false,
		error: `Unknown model "${requested}".`,
		suggestions,
	};
}

// ---------------------------------------------------------------------------
// Task resolution
// ---------------------------------------------------------------------------

function taskPreview(t: TaskItemType): string {
	return preview(t.task);
}

function buildTask(
	item: TaskItemType,
	agents: ReturnType<typeof discoverAgents>["agents"],
	ctx: Parameters<typeof resolveModel>[1],
	step?: number,
	previousOutput?: string,
): { ok: true; task: ResolvedTask } | { ok: false; error: string; suggestions?: string[] } {
	const agent = item.agent ? agents.find((a) => a.name === item.agent) : undefined;

	if (item.agent && !agent) {
		const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
		return { ok: false, error: `Unknown agent "${item.agent}". Available agents: ${available}.` };
	}

	const systemPrompt = item.systemPrompt ?? agent?.systemPrompt ?? "";
	const modelRequested = item.model ?? agent?.model;

	const resolved = resolveModel(modelRequested, ctx);
	if (!resolved.ok) {
		return { ok: false, error: resolved.error, suggestions: resolved.suggestions };
	}

	let taskText = item.task;
	if (step !== undefined && previousOutput !== undefined) {
		taskText = taskText.replace(/\{previous\}/g, previousOutput);
	}

	return {
		ok: true,
		task: {
			name: item.agent ?? (item.systemPrompt ? "inline" : resolved.model.id),
			task: taskText,
			systemPrompt,
			model: resolved.model.modelId,
			tools: item.tools ?? agent?.tools,
			thinking: item.thinking ?? agent?.thinking,
			timeoutSec: item.timeoutSec ?? agent?.timeoutSec,
			maxTurns: item.maxTurns ?? agent?.maxTurns,
			cwd: item.cwd,
			sessionId: item.sessionId,
			keepSession: item.keepSession,
		},
	};
}

// ---------------------------------------------------------------------------
// Usage / output helpers
// ---------------------------------------------------------------------------

function resultOutput(r: SubagentRunResult): string {
	const output = isFailedResult(r)
		? r.errorMessage || r.stderr || getFinalOutput(r.messages) || "(no output)"
		: getFinalOutput(r.messages) || "(no output)";
	const capped = truncateBytes(output, PARENT_OUTPUT_CAP);
	// Make multi-turn sessions actually threadable: the orchestrator must see the
	// session id in the visible result (details are not shown to the model).
	if (r.sessionId) {
		return `${capped}\n\n[Session: ${r.sessionId} — pass as sessionId to continue this context window]`;
	}
	return capped;
}

/** Truncate message payloads so persisted detail entries stay small. */
function truncateMessagesForStorage(messages: AgentMessage[]): AgentMessage[] {
	return messages.map((m) => {
		if (m.role === "assistant") {
			return {
				...m,
				content: m.content.map((part) => (part.type === "text" ? { ...part, text: truncateBytes(part.text, MESSAGE_TEXT_CAP) } : part)),
			} as AgentMessage;
		}
		if (m.role === "toolResult") {
			return {
				...m,
				content: m.content.map((part) => (part.type === "text" ? { ...part, text: truncateBytes(part.text, MESSAGE_RESULT_CAP) } : part)),
			} as AgentMessage;
		}
		return m;
	});
}

/** Full per-run detail record persisted alongside the summary entry. */
function toDetailRecord(groupId: string, kind: RunRecord["kind"], r: SubagentRunResult, step: number | undefined, live: LiveRun): LiveRun {
	const startedAt = new Date(r.startedAt).getTime();
	return {
		runId: live.runId,
		groupId,
		kind,
		step,
		name: r.name,
		model: r.model,
		task: r.task,
		status: isFailedResult(r) ? "error" : "ok",
		startTime: startedAt,
		endTime: startedAt + (r.durationMs ?? 0),
		usage: {
			input: r.usage.input,
			output: r.usage.output,
			cacheRead: r.usage.cacheRead,
			cacheWrite: r.usage.cacheWrite,
			cost: r.usage.cost,
			contextTokens: r.usage.contextTokens,
			turns: r.usage.turns,
		},
		activities: live.activities.slice(-MAX_STORED_ACTIVITIES),
		currentThinking: live.currentThinking,
		messages: truncateMessagesForStorage(r.messages),
		stopReason: r.stopReason,
		errorMessage: r.errorMessage,
		sessionId: r.sessionId,
	};
}

function toRunRecord(groupId: string, kind: RunRecord["kind"], r: SubagentRunResult, step: number | undefined, runId: string): RunRecord {
	return {
		runId,
		groupId,
		kind,
		name: r.name,
		model: r.model,
		task: preview(r.task, 80),
		step,
		status: isFailedResult(r) ? "error" : "ok",
		exitCode: r.exitCode,
		stopReason: r.stopReason,
		errorMessage: r.errorMessage,
		usage: {
			input: r.usage.input,
			output: r.usage.output,
			cost: r.usage.cost,
			turns: r.usage.turns,
			contextTokens: r.usage.contextTokens,
		},
		sessionId: r.sessionId,
		startedAt: r.startedAt,
		durationMs: r.durationMs,
	};
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	// In-process context windows for multi-turn subagents (sessionId reuse).
	const sessionCache = new Map<string, Agent>();

	// ---- Live run registry (browsable via /subagents while running) ----
	const liveRuns = new Map<string, LiveRun>();

	const trimActivities = (live: LiveRun) => {
		if (live.activities.length > 300) live.activities.splice(0, live.activities.length - 300);
	};

	const startLiveRun = (groupId: string, kind: LiveRun["kind"], spec: ResolvedTask, step?: number): LiveRun => {
		const live: LiveRun = {
			runId: randomUUID(),
			groupId,
			kind,
			step,
			name: spec.name,
			model: spec.model,
			task: spec.task,
			status: "running",
			startTime: Date.now(),
			usage: emptyUsage(),
			activities: [],
			messages: [],
		};
		liveRuns.set(live.runId, live);
		return live;
	};

	const applyRunnerEvent = (live: LiveRun, event: RunnerEvent) => {
		const at = Date.now() - live.startTime;
		switch (event.type) {
			case "message":
				accumulateUsage(live.usage, event.message);
				{
					const text = getFinalOutput([event.message]);
					if (text) live.activities.push({ kind: "message", at, text: truncateBytes(text, 600) });
				}
				break;
			case "tool":
				live.activities.push({ kind: "tool", at, toolName: event.name, argsPreview: preview(JSON.stringify(event.args), 90) });
				break;
			case "toolResult":
				live.activities.push({
					kind: "toolResult",
					at,
					toolName: event.name,
					argsPreview: preview(JSON.stringify(event.args), 90),
					resultPreview: event.resultPreview,
					isError: event.isError,
				});
				break;
			case "thinking":
				live.currentThinking = event.text;
				break;
			case "status":
				live.activities.push({ kind: "status", at, text: event.text });
				break;
		}
		trimActivities(live);
	};

	const finalizeLiveRun = (live: LiveRun, r: SubagentRunResult) => {
		live.status = isFailedResult(r) ? "error" : "ok";
		live.endTime = Date.now();
		live.stopReason = r.stopReason;
		live.errorMessage = r.errorMessage;
		live.sessionId = r.sessionId;
		live.messages = r.messages;
		live.usage = { ...r.usage };
		live.currentThinking = undefined;
	};

	const persistRun = (groupId: string, kind: LiveRun["kind"], r: SubagentRunResult, step: number | undefined, live: LiveRun) => {
		pi.appendEntry(RUN_ENTRY_TYPE, toRunRecord(groupId, kind, r, step, live.runId));
		pi.appendEntry(RUN_DETAIL_ENTRY_TYPE, toDetailRecord(groupId, kind, r, step, live));
	};

	// Register a run that failed before it ever started (bad model/agent/etc.).
	const recordFinishedRun = (groupId: string, kind: LiveRun["kind"], r: SubagentRunResult, step?: number) => {
		const live: LiveRun = {
			runId: randomUUID(),
			groupId,
			kind,
			step,
			name: r.name,
			model: r.model,
			task: r.task,
			status: isFailedResult(r) ? "error" : "ok",
			startTime: new Date(r.startedAt).getTime(),
			endTime: new Date(r.startedAt).getTime() + (r.durationMs ?? 0),
			usage: { ...r.usage },
			activities: [],
			messages: r.messages,
			stopReason: r.stopReason,
			errorMessage: r.errorMessage,
			sessionId: r.sessionId,
		};
		liveRuns.set(live.runId, live);
		persistRun(groupId, kind, r, step, live);
	};

	// Merge the in-memory registry with persisted detail entries for the browser.
	const collectRuns = (ctx: ExtensionContext, filter: string): LiveRun[] => {
		const byId = new Map<string, LiveRun>();
		for (const live of liveRuns.values()) {
			if (!filter || live.name.includes(filter) || live.model.includes(filter)) byId.set(live.runId, live);
		}
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type !== "custom" || entry.customType !== RUN_DETAIL_ENTRY_TYPE || !entry.data) continue;
			const rec = entry.data as LiveRun;
			if (!rec || typeof rec.runId !== "string" || !rec.name) continue;
			if (filter && !rec.name.includes(filter) && !rec.model?.includes(filter)) continue;
			if (!byId.has(rec.runId)) byId.set(rec.runId, rec);
		}
		return [...byId.values()].sort((a, b) => {
			const ar = a.status === "running" ? 0 : 1;
			const br = b.status === "running" ? 0 : 1;
			if (ar !== br) return ar - br;
			return b.startTime - a.startTime;
		});
	};


	// ---- Model-facing capability guide: injected before every agent start ----
	// (before_agent_start chains with other extensions' handlers, e.g. goal-mode.)
	let agentGuideCache: string | null = null;
	const namedAgents = () => {
		if (agentGuideCache === null) {
			const agents = discoverAgents(process.cwd(), "user").agents;
			agentGuideCache = agents.length > 0 ? agents.map((a) => a.name).join(", ") : "(none)";
		}
		return agentGuideCache;
	};

	// Cheapest configured models first — the catalog an orchestrator picks workers from.
	let workerCatalogCache: string | null = null;
	const workerCatalog = (ctx: ExtensionContext) => {
		if (workerCatalogCache !== null) return workerCatalogCache;
		const models = ctx.modelRegistry
			.getAvailable()
			.filter((m) => ctx.modelRegistry.hasConfiguredAuth(m));
		if (models.length === 0) return "";
		const sorted = [...models].sort((a, b) => {
			const pa = (a.cost.input ?? 0) + (a.cost.output ?? 0);
			const pb = (b.cost.input ?? 0) + (b.cost.output ?? 0);
			return pa - pb;
		});
		workerCatalogCache = sorted
			.slice(0, 6)
			.map((m) => `${m.provider}/${m.id} (${Math.round(m.contextWindow / 1024)}k ctx)`)
			.join(", ");
		return workerCatalogCache;
	};

	const capabilityPrompt = (ctx: ExtensionContext) => {
		const lines = [
			"## Subagent extension",
			"You have the `subagent` tool: delegate work to a subagent with its OWN isolated context window and any registered model. Use it for independent research/analysis/edits that would otherwise pollute your context.",
			`Modes: single ({task, model?, agent?|systemPrompt?, tools?, thinking?, timeoutSec?, maxTurns?, cwd?}) · parallel ({tasks:[...]}, sequential unless parallelLimit>1) · chain ({chain:[...]}, {previous} = prior step output).`,
			`model: "provider/id" or bare id (validated before running). Named agents: ${namedAgents()} (or use inline systemPrompt).`,
			"Multi-turn memory: keepSession:true returns `[Session: <uuid>]` in the result; pass that uuid as sessionId in a later call to continue the SAME context window.",
			"Watchdogs: timeoutSec / maxTurns abort runaway subagents; parent aborts propagate.",
		];
		const catalog = workerCatalog(ctx);
		if (catalog) {
			lines.push(
				"Orchestrator pattern: you're the planner — delegate heavy or parallelizable work to cheap worker models instead of doing it in your own context. Pick the cheapest model that fits each subtask; keep task texts narrow with an explicit expected output; set thinking to off for cheap/fast workers; parallel for independent fan-out; chain for dependent steps ({previous}); keepSession for shared worker memory. The result text is the worker's concise final answer.",
				`Cheapest configured worker models: ${catalog}.`,
			);
		}
		return lines.join("\n");
	};

	// Capability guide injected before every agent start (registered once at load;
	// chains with other extensions' handlers, e.g. goal-mode).
	pi.on("before_agent_start", async (event, ctx) => ({
		systemPrompt: `${event.systemPrompt}\n\n${capabilityPrompt(ctx)}`,
	}));

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to subagents with isolated context windows, any registered model.",
			"Single: {agent|model|systemPrompt, task}. Parallel: {tasks:[...]}. Chain: {chain:[...]} with {previous} placeholder.",
			'Model is arbitrary: "provider/id", "provider/*", or bare id; validated before running.',
			"Each subagent runs in-process with its own context window (no extra pi processes).",
			"Tasks run sequentially by default; each subagent is a separate in-process Agent, so concurrency is limited to 1 unless parallelLimit > 1.",
			"keepSession:true returns sessionId to continue the same context window later.",
			"thinking: reasoning level for the subagent model (off by default; raise to low/high for harder tasks).",
			"timeoutSec / maxTurns watchdog the subagent.",
			`Agents: ${formatAgentList(discoverAgents(process.cwd(), "user").agents, 5).text}.`,
		].join(" "),
		parameters: SubagentParams,
		promptGuidelines: [
			"Use subagent to delegate independent, parallelizable work to a fresh context window.",
			"Prefer task-specific systemPrompt and tools allowlists so subagents stay focused.",
		],


		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const groupId = randomUUID();
			const agentScope: AgentScope = params.agentScope ?? "user";
			const discovery = discoverAgents(ctx.cwd, agentScope);
			const agents = discovery.agents;

			const hasSingle = params.task !== undefined;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasChain = (params.chain?.length ?? 0) > 0;
			const modeCount = Number(hasSingle) + Number(hasTasks) + Number(hasChain);

			if (modeCount !== 1) {
				return {
					content: [
						{
							type: "text",
							text: `Invalid subagent parameters: provide exactly one mode (task, tasks, or chain).\nAvailable agents: ${formatAgentList(agents, 8).text}`,
						},
					],
					details: {},
					isError: true,
				};
			}

			if (signal.aborted) {
				return {
					content: [{ type: "text", text: "Subagent request canceled before start because the parent request was aborted." }],
					details: {},
					isError: true,
				};
			}

			// Project-agent confirmation (headless-safe).
			if ((agentScope === "project" || agentScope === "both") && ctx.hasUI) {
				const items: Array<{ agent?: string }> =
					params.tasks ?? params.chain ?? (hasSingle ? [params] : []);
				const requestedNames = new Set(
					items.map((t) => t.agent).filter((n): n is string => Boolean(n)),
				);
				const projectAgentsRequested = agents.filter((a) => a.source === "project" && requestedNames.has(a.name));
				if (projectAgentsRequested.length > 0) {
					const names = projectAgentsRequested.map((a) => a.name).join(", ");
					const ok = await ctx.ui.confirm(
						"Run project-local agents?",
						`Agents: ${names}\nSource: ${discovery.projectAgentsDir}\n\nProject agents are repo-controlled. Continue only for trusted repositories.`,
					);
					if (!ok) {
						return {
							content: [{ type: "text", text: "Canceled: project-local agents not approved." }],
							details: {},
							isError: true,
						};
					}
				}
			}

			const makeDetails = (results: SubagentRunResult[], mode: "single" | "parallel" | "chain", live?: LiveRun[]) => ({
				mode,
				results,
				live,
			});

			// Throttled streaming updates — stream a live per-subagent dashboard.
			let lastUpdate = 0;
			const emitDashboard = (mode: "single" | "parallel" | "chain", force = false) => {
				if (!onUpdate) return;
				const now = Date.now();
				if (!force && now - lastUpdate < UPDATE_THROTTLE_MS) return;
				lastUpdate = now;
				const live = [...liveRuns.values()].filter((r) => r.groupId === groupId);
				onUpdate({
					content: [{ type: "text", text: liveDashboardText(live) }],
					details: makeDetails([], mode, live),
				});
			};

			const runOne = async (
				item: TaskItemType,
				mode: "single" | "parallel" | "chain",
				step?: number,
				previousOutput?: string,
			): Promise<SubagentRunResult> => {
				const resolved = buildTask(item, agents, ctx, step, previousOutput);
				if (!resolved.ok) {
					const errText = resolved.suggestions?.length
						? `${resolved.error} Did you mean: ${resolved.suggestions.join(", ")}?`
						: resolved.error;
					const result: SubagentRunResult = {
						name: item.agent ?? "inline",
						task: item.task,
						exitCode: 2,
						messages: [],
						stderr: errText,
						usage: emptyUsage(),
						model: item.model ?? "unknown",
						timeoutKilled: false,
						maxTurnsKilled: false,
						aborted: false,
						startedAt: new Date().toISOString(),
						durationMs: 0,
					};
					recordFinishedRun(groupId, mode, result, step);
					emitDashboard(mode, true);
					return result;
				}

				const spec = resolved.task;
				const live = startLiveRun(groupId, mode, spec, step);

				const result = await runSubagent(spec, {
					defaultCwd: ctx.cwd,
					getModel: (id) =>
						ctx.modelRegistry
							.getAvailable()
							.find((m) => `${m.provider}/${m.id}` === id || m.id === id) as never,
					getProvider: (providerId) => ctx.modelRegistry.getProvider(providerId) as never,
					getApiKey: async (providerId) => {
						try {
							return await ctx.modelRegistry.getApiKeyForProvider(providerId);
						} catch {
							return undefined;
						}
					},
					sessionCache,
					signal,
					onEvent: (event) => {
						applyRunnerEvent(live, event);
						emitDashboard(mode);
					},
				});

				finalizeLiveRun(live, result);
				persistRun(groupId, mode, result, step, live);
				emitDashboard(mode, true);
				return result;
			};

			// ---- Single mode ----
			if (hasSingle) {
				const result = await runOne(params as TaskItemType, "single");
				if (isFailedResult(result)) {
					return {
						content: [{ type: "text", text: `Subagent failed (${result.name}): ${resultOutput(result)}` }],
						details: makeDetails([result], "single"),
						isError: true,
					};
				}
				return {
					content: [{ type: "text", text: resultOutput(result) }],
					details: makeDetails([result], "single"),
				};
			}

			// ---- Chain mode ----
			if (params.chain && params.chain.length > 0) {
				const results: SubagentRunResult[] = [];
				let previousOutput = "";
				for (let i = 0; i < params.chain.length; i++) {
					const stepItem = params.chain[i];
					const result = await runOne(stepItem, "chain", i + 1, previousOutput);
					results.push(result);
					if (isFailedResult(result)) {
						return {
							content: [
								{
									type: "text",
									text: `Chain stopped at step ${i + 1} (${result.name}): ${resultOutput(result)}`,
								},
							],
							details: makeDetails(results, "chain"),
							isError: true,
						};
					}
					previousOutput = getFinalOutput(result.messages) || previousOutput;
				}
				return {
					content: [{ type: "text", text: resultOutput(results[results.length - 1]) }],
					details: makeDetails(results, "chain"),
				};
			}

			// ---- Parallel mode ----
			const tasks = params.tasks ?? [];
			if (tasks.length > MAX_PARALLEL_TASKS) {
				return {
					content: [
						{
							type: "text",
							text: `Too many parallel tasks (${tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
						},
					],
					details: {},
					isError: true,
				};
			}

			const concurrency = Math.max(1, Math.min(params.parallelLimit ?? DEFAULT_CONCURRENCY, MAX_PARALLEL_TASKS));
			const results: SubagentRunResult[] = new Array(tasks.length);
			let nextIndex = 0;

			const worker = async () => {
				while (true) {
					// Do not claim queued work after a parent cancellation. Active runs
					// still receive the signal through runSubagent and stop promptly.
					if (signal.aborted) return;
					const current = nextIndex++;
					if (current >= tasks.length) return;
					const result = await runOne(tasks[current], "parallel");
					results[current] = result;
				}
			};
			await Promise.all(new Array(concurrency).fill(null).map(() => worker()));

			const done = results.filter((r) => r !== undefined).length;
			const failed = results.filter((r) => r && isFailedResult(r)).length;
			const summary = tasks.map((t: TaskItemType, i: number) => {
				const r = results[i];
				if (!r) return `- ${t.agent ?? "task"} ${i + 1}: (missing)`;
				const icon = isFailedResult(r) ? "✗" : "✓";
				return `- ${icon} ${r.name} (${r.model}): ${truncateBytes(resultOutput(r), 2000)}`;
			});
			return {
				content: [
					{
						type: "text",
						text: `Parallel: ${done - failed}/${done} succeeded.\n\n${summary.join("\n\n")}`,
					},
				],
				details: makeDetails(results.filter((r): r is SubagentRunResult => Boolean(r)), "parallel"),
			};
		},

		// -------------------------------------------------------------------
		// TUI rendering
		// -------------------------------------------------------------------
		renderCall(args, theme, _context) {
			const scope = args.agentScope ?? "user";
			let text =
				theme.fg("toolTitle", theme.bold("subagent ")) +
				theme.fg("accent", `[${scope}]`);
			if (args.chain) {
				text += `\n${theme.fg("accent", `chain (${args.chain.length} steps)`)}`;
				for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
					text += `\n  ${theme.fg("muted", `${i + 1}.`)} ${theme.fg("accent", args.chain[i].agent ?? "inline")} ${theme.fg("dim", preview(taskPreview(args.chain[i])))}`;
				}
			} else if (args.tasks) {
				text += `\n${theme.fg("accent", `parallel (${args.tasks.length} tasks)`)}`;
				for (const t of args.tasks.slice(0, 3)) {
					text += `\n  ${theme.fg("accent", t.agent ?? "inline")} ${theme.fg("dim", preview(taskPreview(t)))}`;
				}
			} else {
				const name = args.agent ?? (args.model ? args.model : "inline");
				text += `\n${theme.fg("accent", name)} ${theme.fg("dim", preview(args.task ?? ""))}`;
				if (args.model) text += `\n${theme.fg("dim", `model: ${args.model}`)}`;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as
				| { mode?: string; results?: SubagentRunResult[]; live?: LiveRun[] }
				| undefined;
			// Live streaming dashboard (details carried by onUpdate while running).
			if (details?.live && details.live.length > 0) {
				return renderLiveDashboard(details.live, expanded, theme);
			}
			// Final result.
			if (!details || !details.results || details.results.length === 0) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}
			return renderRunResults(details.results, details.mode ?? "single", expanded, theme);
		},
	});

	// -----------------------------------------------------------------------
	// /subagents — browsable live + recent runs
	// -----------------------------------------------------------------------
	const openBrowser = async (args: string, ctx: ExtensionContext) => {
		const filter = (args ?? "").trim();
		const runs = collectRuns(ctx, filter);
		if (runs.length === 0) {
			ctx.ui.notify(filter ? "No subagent runs matched the filter." : "No subagent runs yet in this session.", "info");
			return;
		}
		const active = runs.filter((r) => r.status === "running").length;
		ctx.ui.notify(`Subagents: ${runs.length} run${runs.length === 1 ? "" : "s"}${active ? ` (${active} active)` : ""}. Esc to close.`, "info");
		await ctx.ui.custom<null>(
			(tui, theme, _kb, done) =>
				new SubagentsBrowser(theme, tui, () => done(null), () => collectRuns(ctx, filter)),
			{
				overlay: true,
				overlayOptions: { width: "90%", maxHeight: "80%", anchor: "center" },
			},
		);
	};

	// Non-interactive fallback (print/RPC modes): a plain listing via the widget.
	const renderTextList = (args: string, ctx: ExtensionContext) => {
		const filter = (args ?? "").trim();
		const entries = ctx.sessionManager.getEntries();
		const runs: RunRecord[] = [];
		for (const entry of entries) {
			if (entry.type === "custom" && entry.customType === RUN_ENTRY_TYPE && entry.data) {
				runs.push(entry.data as RunRecord);
			}
		}
		const filtered = filter ? runs.filter((r) => r.name.includes(filter) || r.model.includes(filter)) : runs;
		const recent = filtered.slice(-15).reverse();

		if (recent.length === 0) {
			ctx.ui.notify("No subagent runs recorded yet in this session.", "info");
			return;
		}

		const lines: string[] = [];
		let totalInput = 0;
		let totalCost = 0;
		let totalTurns = 0;
		for (const r of recent) {
			lines.push(`${statusIcon(r.status)} ${r.kind === "single" ? r.name : `${r.kind}:${r.step ?? ""}:${r.name}`} [${r.model}] ${r.stopReason ?? ""} ${r.durationMs !== undefined ? `${(r.durationMs / 1000).toFixed(1)}s` : "…"}`);
			lines.push(`   ${r.task}`);
			const usage = usageLine({
				input: r.usage.input,
				output: r.usage.output,
				cacheRead: 0,
				cacheWrite: 0,
				cost: r.usage.cost,
				contextTokens: r.usage.contextTokens,
				turns: r.usage.turns,
			});
			if (usage) lines.push(`   ${usage}`);
			if (r.sessionId) lines.push(`   session: ${r.sessionId}`);
			totalInput += r.usage.input;
			totalCost += r.usage.cost;
			totalTurns += r.usage.turns;
		}
		lines.push("");
		lines.push(`Total: ${recent.length} run(s), ${totalTurns} turns, ↑${formatTokens(totalInput)} input, $${totalCost.toFixed(4)} cost`);
		ctx.ui.setWidget("subagents", lines);
	};

	pi.registerCommand("subagents", {
		description: "Browse subagent runs — live activity, per-run transcripts (arg: name/model filter)",
		handler: async (args, ctx) => {
			if (ctx.mode === "tui" && ctx.hasUI) {
				await openBrowser(args, ctx);
			} else {
				renderTextList(args, ctx);
			}
		},
	});
}
