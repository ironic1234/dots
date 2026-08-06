/**
 * Subagent runner — fully in-process.
 *
 * Each subagent is an `Agent` (pi-agent-core) with its OWN transcript
 * (isolated context window), its own model from the registry, and its own
 * tool set. No extra `pi` processes are spawned, so running subagents costs
 * only the LLM API calls themselves.
 *
 * Multi-turn prompting: when `keepSession` is set, the `Agent` instance is
 * cached in `opts.sessionCache` under a generated sessionId; a later call with
 * that `sessionId` continues the SAME context window in place.
 *
 * Watchdogs: per-run timeout and maxTurns both abort the Agent via its
 * abort controller. Parent abort signals are forwarded too.
 */

import type { Model, Provider, ThinkingLevel } from "@earendil-works/pi-ai";
import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";

export interface SubagentTaskSpec {
	name: string;
	task: string;
	systemPrompt: string;
	/** Resolved model id, e.g. "provider/id" or bare id. */
	model: string;
	tools?: string[];
	thinking?: string;
	timeoutSec?: number;
	maxTurns?: number;
	cwd?: string;
	/** Continue an existing in-process subagent context window. */
	sessionId?: string;
	/** Cache this subagent's context window so it can be continued later. */
	keepSession?: boolean;
}

export interface SubagentUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export interface SubagentRunResult {
	name: string;
	task: string;
	exitCode: number;
	messages: AgentMessage[];
	stderr: string;
	usage: SubagentUsage;
	model: string;
	stopReason?: string;
	errorMessage?: string;
	sessionId?: string;
	timeoutKilled: boolean;
	maxTurnsKilled: boolean;
	aborted: boolean;
	startedAt: string;
	durationMs: number;
}

export type RunnerEvent =
	| { type: "message"; message: AgentMessage }
	| { type: "tool"; name: string; args: Record<string, unknown> }
	| { type: "toolResult"; name: string; args: Record<string, unknown>; resultPreview: string; isError: boolean }
	| { type: "thinking"; text: string }
	| { type: "status"; text: string };

export interface RunOptions {
	defaultCwd: string;
	/** Resolve a "provider/id" (or bare id) string to a registry Model. */
	getModel: (modelId: string) => Model<any> | undefined;
	/** Resolve a provider id to its pi-ai Provider (for streaming). */
	getProvider: (providerId: string) => Provider | undefined;
	/** Resolve an API key / OAuth token for a provider, per LLM call. */
	getApiKey?: (providerId: string) => Promise<string | undefined> | string | undefined;
	signal?: AbortSignal;
	onEvent?: (event: RunnerEvent) => void;
	/** Cache of live subagent context windows keyed by sessionId. */
	sessionCache?: Map<string, Agent>;
}

const BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

const TOOL_FACTORIES: Record<(typeof BUILTIN_TOOLS)[number], (cwd: string) => { name: string; label: string; description: string; parameters: unknown; prepareArguments?: (args: unknown) => unknown; executionMode?: unknown; execute: (toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: unknown, ctx: unknown) => Promise<unknown> }> = {
	read: createReadToolDefinition as never,
	bash: createBashToolDefinition as never,
	edit: createEditToolDefinition as never,
	write: createWriteToolDefinition as never,
	grep: createGrepToolDefinition as never,
	find: createFindToolDefinition as never,
	ls: createLsToolDefinition as never,
};

export function emptyUsage(): SubagentUsage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

export function accumulateUsage(target: SubagentUsage, message: AgentMessage): void {
	if (message.role !== "assistant") return;
	const usage = (message as { usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number; cost?: { total?: number } } }).usage;
	if (!usage) return;
	target.input += usage.input || 0;
	target.output += usage.output || 0;
	target.cacheRead += usage.cacheRead || 0;
	target.cacheWrite += usage.cacheWrite || 0;
	target.cost += usage.cost?.total || 0;
	target.contextTokens = Math.max(target.contextTokens, usage.totalTokens || 0);
}

/** Get the last assistant text content of a message list. */
export function getFinalOutput(messages: AgentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;
		for (const part of msg.content) {
			if (part.type === "text" && part.text.trim()) return part.text;
		}
	}
	return "";
}

/** Concatenated text of an assistant message (for live "thinking" previews). */
export function assistantText(message: AgentMessage): string {
	if (message.role !== "assistant") return "";
	return message.content
		.filter((p) => p.type === "text")
		.map((p) => p.text)
		.join("");
}

/** One-line preview of a tool result (for live dashboards). */
function toolResultPreview(result: unknown): string {
	const content = (result as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content;
	if (!Array.isArray(content)) return "";
	const text = content
		.filter((c): c is { type: string; text: string } => c?.type === "text" && typeof c.text === "string")
		.map((c) => c.text)
		.join("\n")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > 280 ? `${text.slice(0, 279)}…` : text;
}

function resolveModelId(requested: string, getModel: RunOptions["getModel"]): Model<any> | undefined {
	// spec.model is a concrete "provider/id" (resolved by the caller), but
	// tolerate bare ids and provider/* patterns defensively.
	const direct = getModel(requested);
	if (direct) return direct;
	if (requested.endsWith("/*")) {
		const provider = requested.slice(0, -2);
		return getModel(`${provider}/*`);
	}
	if (requested.includes("/")) return getModel(requested.split("/")[1]);
	return undefined;
}

function buildTools(spec: SubagentTaskSpec, defaultCwd: string, model: Model<any>, thinking?: string): AgentToolLike[] {
	const cwd = spec.cwd ?? defaultCwd;

	const allowed = spec.tools && spec.tools.length > 0 ? new Set(spec.tools) : null;
	const mockCtx = {
		model,
		thinkingLevel: thinking,
		sessionManager: {
			getSessionId: () => `subagent-${process.pid}`,
			getSessionFile: () => undefined,
		},
	};

	const wrapped: AgentToolLike[] = [];
	for (const name of BUILTIN_TOOLS) {
		if (allowed && !allowed.has(name)) continue;
		const def = TOOL_FACTORIES[name](cwd) as unknown as {
			name: string;
			label: string;
			description: string;
			parameters: unknown;
			prepareArguments?: (args: unknown) => unknown;
			executionMode?: unknown;
			execute: (...args: unknown[]) => unknown;
		};
		wrapped.push({
			name: def.name,
			label: def.label,
			description: def.description,
			parameters: def.parameters,
			prepareArguments: def.prepareArguments,
			executionMode: def.executionMode,
			execute: (toolCallId, params, signal, onUpdate) =>
				// Built-in tools expect an ExtensionContext as the 5th arg; a
				// minimal mock is sufficient (bash reads model/session env).
				def.execute(toolCallId, params, signal, onUpdate, mockCtx) as Promise<unknown>,
		});
	}
	return wrapped;
}

// Minimal structural shape accepted by AgentState.tools.
type AgentToolLike = {
	name: string;
	label: string;
	description: string;
	parameters: unknown;
	prepareArguments?: (args: unknown) => unknown;
	executionMode?: unknown;
	execute: (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown) => Promise<unknown>;
};

export async function runSubagent(spec: SubagentTaskSpec, opts: RunOptions): Promise<SubagentRunResult> {
	const startedAt = new Date().toISOString();
	const startMs = Date.now();

	const result: SubagentRunResult = {
		name: spec.name,
		task: spec.task,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: emptyUsage(),
		model: spec.model,
		timeoutKilled: false,
		maxTurnsKilled: false,
		aborted: false,
		startedAt,
		durationMs: 0,
	};

	// Agent.abort() only affects an active run. If the parent signal was already
	// canceled before prompt(), aborting the idle Agent would be a no-op and the
	// subagent would incorrectly start with a fresh internal controller.
	if (opts.signal?.aborted) {
		result.exitCode = 1;
		result.aborted = true;
		result.stopReason = "aborted";
		result.errorMessage = "Subagent canceled before start because the parent request was aborted";
		result.durationMs = Date.now() - startMs;
		result.sessionId = spec.sessionId;
		return result;
	}

	// ---- Resolve model + provider ----
	const model = resolveModelId(spec.model, opts.getModel);
	if (!model) {
		result.exitCode = 2;
		result.stopReason = "error";
		result.errorMessage = `Model not available: ${spec.model}`;
		return result;
	}
	const provider = opts.getProvider(model.provider);
	if (!provider) {
		result.exitCode = 2;
		result.stopReason = "error";
		result.errorMessage = `Provider not available for model: ${spec.model} (provider ${model.provider})`;
		return result;
	}
	result.model = `${model.provider}/${model.id}`;

	// ---- Reuse or create the context window ----
	let agent: Agent | undefined;
	if (spec.sessionId && opts.sessionCache) {
		agent = opts.sessionCache.get(spec.sessionId);
		if (!agent) {
			result.exitCode = 2;
			result.stopReason = "error";
			result.errorMessage = `Unknown subagent session: ${spec.sessionId} (in-process context windows do not survive a pi restart)`;
			return result;
		}
	}

	if (agent?.state.isStreaming) {
		result.exitCode = 2;
		result.stopReason = "error";
		result.errorMessage = `Subagent session ${spec.sessionId} is already running and cannot be used concurrently`;
		result.durationMs = Date.now() - startMs;
		return result;
	}

	if (!agent) {
		agent = new Agent({
			streamFn: (m, context, options) => provider.streamSimple(m, context, options),
			getApiKey: opts.getApiKey,
			initialState: {
				systemPrompt:
					spec.systemPrompt ||
					"You are a helpful assistant. Complete the task and end with a concise final answer (1-3 sentences) unless the task explicitly requests a longer output.",
				model,
				thinkingLevel: (spec.thinking as ThinkingLevel) ?? "off",
				tools: buildTools(spec, opts.defaultCwd, model, spec.thinking) as never,
				messages: [],
			},
		});
	}

	let sessionId = spec.sessionId;
	if (spec.keepSession && opts.sessionCache && !sessionId) {
		sessionId = randomUUID();
		opts.sessionCache.set(sessionId, agent!);
	}

	// ---- Watchdogs ----
	let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
	// maxTurns and reported usage are per invocation, including when continuing
	// a cached context window. Historical assistant messages must not count.
	let turns = 0;

	const abortAgent = (reason: "timeout" | "maxTurns" | "parent") => {
		if (reason === "timeout") {
			result.timeoutKilled = true;
			result.stopReason = "timeout";
			result.errorMessage = `Timed out after ${spec.timeoutSec}s`;
			opts.onEvent?.({ type: "status", text: `⏰ ${spec.name}: timeout after ${spec.timeoutSec}s, aborting` });
		} else if (reason === "maxTurns") {
			result.maxTurnsKilled = true;
			result.stopReason = "maxTurns";
			result.errorMessage = `Exceeded maxTurns=${spec.maxTurns}`;
			opts.onEvent?.({ type: "status", text: `⏰ ${spec.name}: maxTurns=${spec.maxTurns} reached, aborting` });
		} else {
			result.aborted = true;
			result.stopReason = "aborted";
			result.errorMessage = "Subagent aborted by parent";
		}
		try {
			agent?.abort();
		} catch {
			/* already settled */
		}
	};

	const checkMaxTurns = () => {
		// Use > (not >=): the model is allowed maxTurns full assistant turns. The
		// abort fires only when it tries to start turn maxTurns+1 with a tool call,
		// so it gets maxTurns complete tool-use cycles instead of maxTurns-1.
		if (spec.maxTurns && turns > spec.maxTurns && !result.maxTurnsKilled && !result.timeoutKilled && !result.aborted) {
			abortAgent("maxTurns");
		}
	};

	// Throttled live "thinking" previews (message_update fires per streamed chunk).
	const THINKING_THROTTLE_MS = 200;
	let lastThinkingEmit = 0;
	const emitThinkingThrottled = (text: string) => {
		const now = Date.now();
		if (now - lastThinkingEmit < THINKING_THROTTLE_MS) return;
		lastThinkingEmit = now;
		opts.onEvent?.({ type: "thinking", text });
	};

	if (spec.timeoutSec) {
		timeoutTimer = setTimeout(() => abortAgent("timeout"), spec.timeoutSec * 1000);
	}

	const onParentAbort = () => abortAgent("parent");
	if (opts.signal) {
		if (opts.signal.aborted) onParentAbort();
		else opts.signal.addEventListener("abort", onParentAbort, { once: true });
	}

	// ---- Live events ----
	const toolCallArgs = new Map<string, Record<string, unknown>>();
	const unsubscribe = agent.subscribe((event) => {
		if (event.type === "message_end" && event.message.role === "assistant") {
			const msg = event.message;
			turns++;
			accumulateUsage(result.usage, msg);
			if (msg.model) result.model = msg.model;
			// Watchdog/parent-abort reasons take precedence over the last streamed one.
			if (!result.timeoutKilled && !result.maxTurnsKilled && !result.aborted) {
				if (msg.stopReason) result.stopReason = msg.stopReason;
				if (msg.errorMessage) result.errorMessage = msg.errorMessage;
			}
			opts.onEvent?.({ type: "message", message: msg });
			// Reaching the limit on a final answer is success. Abort only when the
			// model is asking to continue into another tool/assistant turn.
			if (msg.stopReason === "toolUse") checkMaxTurns();
		}
		if (event.type === "tool_execution_start") {
			toolCallArgs.set(event.toolCallId, event.args ?? {});
			opts.onEvent?.({ type: "tool", name: event.toolName, args: event.args ?? {} });
		}
		if (event.type === "tool_execution_end") {
			opts.onEvent?.({
				type: "toolResult",
				name: event.toolName,
				args: toolCallArgs.get(event.toolCallId) ?? {},
				resultPreview: toolResultPreview(event.result),
				isError: event.isError,
			});
		}
		if (event.type === "message_update") {
			const text = assistantText(event.message);
			if (text.trim()) emitThinkingThrottled(text);
		}
	});

	try {
		await agent.prompt(`Task: ${spec.task}`);
		await agent.waitForIdle();
	} catch (error) {
		result.exitCode = 1;
		if (!result.errorMessage) result.errorMessage = error instanceof Error ? error.message : String(error);
	} finally {
		if (timeoutTimer) clearTimeout(timeoutTimer);
		if (opts.signal) opts.signal.removeEventListener("abort", onParentAbort);
		unsubscribe();
	}

	// ---- Collect results ----
	result.messages = agent.state.messages.filter((m) => m.role === "assistant" || m.role === "toolResult");
	result.durationMs = Date.now() - startMs;

	// Backfill stopReason/errorMessage from the transcript in case the run was
	// aborted mid-stream. Usage/turns are already accumulated per-run from the
	// subscription (which only sees this run's events).
	const collected = agent.state.messages.filter((m) => m.role === "assistant");
	const failureMessage = collected[collected.length - 1];
	// Preserve the specific watchdog/parent cancellation diagnostic instead of
	// replacing it with a provider's generic "Request was aborted" message.
	const controlledAbort = result.timeoutKilled || result.maxTurnsKilled || result.aborted;
	if (failureMessage && !controlledAbort) {
		if (failureMessage.stopReason) result.stopReason = failureMessage.stopReason;
		if (failureMessage.errorMessage) result.errorMessage = failureMessage.errorMessage;
	}

	if (result.timeoutKilled) result.stopReason = "timeout";
	if (result.maxTurnsKilled) result.stopReason = "maxTurns";
	if (result.aborted) result.stopReason = "aborted";

	if (result.timeoutKilled || result.maxTurnsKilled || result.aborted) result.exitCode = 1;
	else if (result.stopReason === "error" || result.stopReason === "aborted") result.exitCode = 1;
	result.usage.turns = turns;
	result.sessionId = sessionId;
	return result;
}
