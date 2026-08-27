/**
 * Deterministic tests for the subagents extension (runner events + TUI helpers).
 * Run with: bun test agent/tests/subagents.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
	runSubagent,
	getFinalOutput,
	type SubagentTaskSpec,
	type RunnerEvent,
} from "../extensions/subagents/runner.ts";
import {
	messageSegments,
	runDisplayName,
	statusIcon,
	truncateBytes,
	usageLine,
	formatTokens,
	formatElapsed,
	activityPlainText,
	type RunActivity,
} from "../extensions/subagents/ui.ts";
import { applyAgentPolicy, ENFORCED_AGENT_PROFILES } from "../extensions/subagents/policy.ts";

const fakeModel = {
	id: "fake-model",
	name: "Fake Model",
	api: "openai-completions",
	provider: "fake",
	baseUrl: "",
	reasoning: false,
	thinkingLevelMap: undefined,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 4096,
};

function getTestModel(id: string) {
	if (id === "fake/fake-model" || id === "fake-model") return fakeModel;
	if (id === "openai-codex/gpt-5.6-sol" || id === "openai-codex/gpt-5.6-luna") {
		const modelId = id.split("/")[1]!;
		return { ...fakeModel, id: modelId, name: modelId, provider: "openai-codex", reasoning: true };
	}
	return undefined;
}

type StubConfig = {
	toolTurns?: number;
	finalText?: string | ((context: any) => string);
};

function stubProvider(config: StubConfig) {
	let invocations = 0;
	const streamSimple = async (_model: unknown, context: any, _options: any) => {
		const i = invocations++;
		const useTool = i < (config.toolTurns ?? 0);
		const text =
			typeof config.finalText === "function"
				? (config.finalText as (c: any) => string)(context)
				: (config.finalText ?? "fake-result");
		const content = useTool
			? [{ type: "toolCall", id: `tc-${i}`, name: "bash", arguments: { command: "echo hi" } }]
			: [{ type: "text", text }];
		const finalMsg: any = {
			role: "assistant",
			content,
			api: "openai-completions",
			provider: "fake",
			model: "fake-model",
			usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 110, cost: { total: 0.001 } },
			stopReason: useTool ? "toolUse" : "stop",
			timestamp: Date.now(),
		};
		const gen = (async function* () {
			yield { type: "start", partial: finalMsg };
			if (!useTool) {
				yield { type: "text_delta", contentIndex: 0, delta: text, partial: finalMsg };
			}
			yield { type: "done", reason: useTool ? "toolUse" : "stop", message: finalMsg };
		})();
		const withResult = gen as unknown as { [Symbol.asyncIterator](): AsyncGenerator<any>; result(): any };
		withResult.result = () => finalMsg;
		return withResult;
	};
	return {
		provider: { streamSimple } as never,
		get invocations() {
			return invocations;
		},
	};
}

function spec(overrides: Partial<SubagentTaskSpec> = {}): SubagentTaskSpec {
	return {
		name: "test-agent",
		task: "do the thing",
		systemPrompt: "You are a test agent.",
		model: "fake/fake-model",
		...overrides,
	};
}

function opts(
	stub: ReturnType<typeof stubProvider>,
	extra: Partial<Parameters<typeof runSubagent>[1]> = {},
): Parameters<typeof runSubagent>[1] {
	return {
		defaultCwd: "/tmp",
		getModel: (id: string) => (id === "fake/fake-model" || id === "fake-model" ? fakeModel : undefined),
		getProvider: () => stub.provider,
		sessionCache: new Map(),
		...extra,
	} as Parameters<typeof runSubagent>[1];
}

describe("named subagent policies", () => {
	test("hard-locks bundled profile controls over request overrides", () => {
		const controls = applyAgentPolicy("planner", {
			model: "fake/other-model",
			tools: ["write"],
			thinking: "max",
			timeoutSec: 1,
			maxTurns: 1,
		});

		expect(controls).toEqual({
			model: "openai-codex/gpt-5.6-sol",
			thinking: "medium",
			tools: ["read", "grep", "find", "ls"],
			timeoutSec: 240,
			maxTurns: 18,
		});
	});

	test("matches the complete requested contract for every bundled profile", () => {
		expect(ENFORCED_AGENT_PROFILES).toEqual({
			planner: {
				model: "openai-codex/gpt-5.6-sol",
				thinking: "medium",
				tools: ["read", "grep", "find", "ls"],
				timeoutSec: 240,
				maxTurns: 18,
			},
			reviewer: {
				model: "openai-codex/gpt-5.6-sol",
				thinking: "low",
				tools: ["read", "grep", "find", "ls", "bash"],
				timeoutSec: 240,
				maxTurns: 22,
			},
			scout: {
				model: "openai-codex/gpt-5.6-luna",
				thinking: "medium",
				tools: ["read", "grep", "find", "ls", "bash"],
				timeoutSec: 180,
				maxTurns: 18,
			},
			worker: {
				model: "openai-codex/gpt-5.6-luna",
				thinking: "xhigh",
				tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
				timeoutSec: 600,
				maxTurns: 40,
			},
		});
	});

	test("keeps inline/custom controls configurable", () => {
		const controls = { model: "fake/model", tools: ["read"], thinking: "low", timeoutSec: 9, maxTurns: 2 };
		expect(applyAgentPolicy("custom", controls)).toBe(controls);
		expect(Object.keys(ENFORCED_AGENT_PROFILES)).toEqual(["planner", "reviewer", "scout", "worker"]);
	});

	test("installs the locked controls in the actual runner", async () => {
		const stub = stubProvider({ finalText: "DONE" });
		const sessionCache = new Map();
		const result = await runSubagent(
			spec({
				name: "scout",
				model: "fake/fake-model",
				tools: ["write"],
				thinking: "max",
				keepSession: true,
			}),
			opts(stub, { getModel: getTestModel, sessionCache }),
		);

		expect(result.exitCode).toBe(0);
		const agent = sessionCache.get(result.sessionId!);
		expect(agent?.state.model.provider).toBe("openai-codex");
		expect(agent?.state.model.id).toBe("gpt-5.6-luna");
		expect(agent?.state.thinkingLevel).toBe("medium");
		expect(agent?.state.tools.map((tool) => tool.name)).toEqual(["read", "bash", "grep", "find", "ls"]);

		const resumed = await runSubagent(
			spec({
				name: "scout",
				model: "fake/fake-model",
				tools: ["write"],
				thinking: "max",
				sessionId: result.sessionId,
			}),
			opts(stub, { getModel: getTestModel, sessionCache }),
		);
		expect(resumed.exitCode).toBe(0);
		expect(stub.invocations).toBe(2);
	});

	test("does not allow incompatible sessions to bypass the profile", async () => {
		const stub = stubProvider({ finalText: "DONE" });
		const sessionCache = new Map();
		const first = await runSubagent(
			spec({ name: "custom", tools: ["read"], thinking: "low", keepSession: true }),
			opts(stub, { getModel: getTestModel, sessionCache }),
		);
		const invocationsBeforeReuse = stub.invocations;
		const reused = await runSubagent(
			spec({
				name: "planner",
				model: "fake/fake-model",
				tools: ["write"],
				thinking: "max",
				sessionId: first.sessionId,
			}),
			opts(stub, { getModel: getTestModel, sessionCache }),
		);

		expect(reused.exitCode).toBe(2);
		expect(reused.errorMessage).toContain("Incompatible subagent session");
		expect(stub.invocations).toBe(invocationsBeforeReuse);
	});

	test("uses the locked worker budget instead of a caller override", async () => {
		const stub = stubProvider({ toolTurns: 2, finalText: "DONE" });
		const result = await runSubagent(
			spec({ name: "worker", model: "fake/fake-model", maxTurns: 1 }),
			opts(stub, { getModel: getTestModel }),
		);

		expect(result.exitCode).toBe(0);
		expect(result.maxTurnsKilled).toBe(false);
		expect(stub.invocations).toBe(3);
	});

	test("does not fall back to a different provider for a locked model", async () => {
		const stub = stubProvider({ finalText: "MUST NOT RUN" });
		const otherProviderModel = { ...fakeModel, id: "gpt-5.6-sol", provider: "other-provider" };
		const result = await runSubagent(
			spec({ name: "planner", model: "fake/fake-model" }),
			opts(stub, {
				getModel: (id: string) => {
					if (id === "gpt-5.6-sol") return otherProviderModel;
					return id === "fake/fake-model" || id === "fake-model" ? fakeModel : undefined;
				},
			}),
		);

		expect(result.exitCode).toBe(2);
		expect(result.errorMessage).toBe("Model not available: openai-codex/gpt-5.6-sol");
		expect(stub.invocations).toBe(0);
	});
});

describe("subagent runner cancellation", () => {
	test("does not start a provider request when the parent is already aborted", async () => {
		const stub = stubProvider({ finalText: "MUST NOT RUN" });
		const controller = new AbortController();
		controller.abort();

		const result = await runSubagent(spec(), opts(stub, { signal: controller.signal }));

		expect(result.exitCode).toBe(1);
		expect(result.aborted).toBe(true);
		expect(result.stopReason).toBe("aborted");
		expect(result.errorMessage).toContain("canceled before start");
		expect(stub.invocations).toBe(0);
	});

	test("allows a final answer on the maxTurns boundary", async () => {
		const stub = stubProvider({ finalText: "DONE" });
		const result = await runSubagent(spec({ maxTurns: 1 }), opts(stub));

		expect(result.exitCode).toBe(0);
		expect(result.stopReason).toBe("stop");
		expect(result.maxTurnsKilled).toBe(false);
	});

	test("stops a tool loop at maxTurns with a specific diagnostic", async () => {
		const stub = stubProvider({ toolTurns: 2, finalText: "NEVER" });
		const result = await runSubagent(spec({ maxTurns: 1 }), opts(stub));

		expect(result.exitCode).toBe(1);
		expect(result.stopReason).toBe("maxTurns");
		expect(result.errorMessage).toBe("Exceeded maxTurns=1");
	});

	test("uses one finalization turn instead of killing a productive run at the boundary", async () => {
		const stub = stubProvider({ toolTurns: 1, finalText: "DONE AFTER FINALIZATION" });
		const result = await runSubagent(spec({ maxTurns: 1 }), opts(stub));

		expect(result.exitCode).toBe(0);
		expect(result.stopReason).toBe("stop");
		expect(result.maxTurnsKilled).toBe(false);
		expect(getFinalOutput(result.messages)).toBe("DONE AFTER FINALIZATION");
		expect(stub.invocations).toBe(2);
	});
});

describe("subagent runner live events", () => {
	test("emits message events with usage", async () => {
		const stub = stubProvider({ finalText: "RESULT" });
		const events: RunnerEvent[] = [];
		const result = await runSubagent(spec(), opts(stub, { onEvent: (e) => events.push(e) }));
		expect(result.exitCode).toBe(0);
		expect(events.some((e) => e.type === "message" && getFinalOutput([(e as any).message]) === "RESULT")).toBe(
			true,
		);
		expect(events.filter((e) => e.type === "message").length).toBe(1);
	});

	test("emits tool + toolResult events with a result preview", async () => {
		const stub = stubProvider({ toolTurns: 1, finalText: "DONE" });
		const events: RunnerEvent[] = [];
		await runSubagent(spec(), opts(stub, { onEvent: (e) => events.push(e) }));

		const tool = events.find((e) => e.type === "tool") as Extract<RunnerEvent, { type: "tool" }> | undefined;
		expect(tool).toBeDefined();
		expect(tool!.name).toBe("bash");

		const toolResult = events.find((e) => e.type === "toolResult") as
			Extract<RunnerEvent, { type: "toolResult" }> | undefined;
		expect(toolResult).toBeDefined();
		expect(toolResult!.name).toBe("bash");
		expect(toolResult!.resultPreview).toContain("hi");
		expect(toolResult!.isError).toBe(false);
	});

	test("emits throttled thinking previews while streaming", async () => {
		const stub = stubProvider({ finalText: "THINK-ABOUT-THIS" });
		const events: RunnerEvent[] = [];
		await runSubagent(spec(), opts(stub, { onEvent: (e) => events.push(e) }));
		const thinking = events.find((e) => e.type === "thinking") as
			Extract<RunnerEvent, { type: "thinking" }> | undefined;
		expect(thinking).toBeDefined();
		expect(thinking!.text).toContain("THINK-ABOUT-THIS");
	});
});

describe("subagent ui helpers", () => {
	test("messageSegments interleaves assistant text, tool calls, and results", () => {
		const segments = messageSegments([
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Let me look." },
					{ type: "toolCall", id: "c1", name: "read", arguments: { path: "a.ts" } },
				],
			} as any,
			{
				role: "toolResult",
				toolCallId: "c1",
				toolName: "read",
				content: [{ type: "text", text: "file contents" }],
				isError: false,
			} as any,
			{
				role: "assistant",
				content: [{ type: "text", text: "Done." }],
			} as any,
		]);

		expect(segments.map((s) => s.type)).toEqual(["text", "toolCall", "toolResult", "text"]);
		const call = segments[1]!;
		const result = segments[2]!;
		expect(call.type).toBe("toolCall");
		if (call.type === "toolCall") {
			expect(call.name).toBe("read");
			expect(call.args).toContain("a.ts");
		}
		if (result.type === "toolResult") {
			expect(result.name).toBe("read");
			expect(result.text).toContain("file contents");
			expect(result.turn).toBe(1);
		}
	});

	test("formatting helpers", () => {
		expect(statusIcon("running")).toBe("⏳");
		expect(statusIcon("ok")).toBe("✓");
		expect(statusIcon("error")).toBe("✗");
		expect(runDisplayName({ kind: "chain", step: 2, name: "worker" })).toBe("chain 2 · worker");
		expect(runDisplayName({ kind: "single", name: "worker" })).toBe("worker");
		expect(formatTokens(1234)).toBe("1.2k");
		expect(formatTokens(42)).toBe("42");
		expect(formatElapsed(1500)).toBe("1.5s");
		expect(formatElapsed(90_000)).toBe("1m30s");
		expect(truncateBytes("hello", 100)).toBe("hello");
		expect(truncateBytes("hello world", 5)).toContain("[truncated]");
		expect(
			usageLine({ input: 1000, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0.001, contextTokens: 0, turns: 2 }),
		).toContain("2 turns");
	});

	test("activityPlainText renders one-liners without ANSI", () => {
		const tool: RunActivity = { kind: "tool", at: 1234, toolName: "bash", argsPreview: '{ command: "ls" }' };
		expect(activityPlainText(tool)).toContain("bash");
		const failed: RunActivity = { kind: "toolResult", at: 2000, toolName: "bash", isError: true };
		expect(activityPlainText(failed)).toContain("✗");
	});
});
