import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const DEFAULT_MAX_ITERATIONS = 32;
const GOAL_CONTEXT_TYPE = "goal-mode-context";
const GOAL_STATE_TYPE = "goal-mode-state";
const GOAL_CAPABILITY_PROMPT = "[GOAL CAPABILITY] The user can start autonomous work with /goal <objective>. When goal mode is active, design explicit verifiable criteria, keep working across turns, and call goal_complete only after every criterion is verified.";

type GoalStatus = "idle" | "active" | "paused" | "completed";

interface GoalState {
  goal: string;
  status: GoalStatus;
  plan: string[];
  progress: string;
  iterations: number;
  maxIterations: number;
  startedAt: string;
  completedAt?: string;
  completionSummary?: string;
}

interface GoalMessage {
  role?: string;
  content?: unknown;
  stopReason?: string;
  customType?: string;
}

interface GoalStateEntry {
  type: "custom";
  customType?: string;
  data?: GoalState;
}

const GoalCompleteParams = Type.Object({
  summary: Type.String({ description: "A concise summary of the completed goal and outcome" }),
  evidence: Type.Optional(
    Type.Array(Type.String(), {
      description: "Concrete checks, files, commands, or observations that verify completion",
      maxItems: 8,
    }),
  ),
});

function textFromMessage(message: unknown): string {
  const candidate = message as GoalMessage;
  if (typeof candidate.content === "string") return candidate.content;
  if (!Array.isArray(candidate.content)) return "";

  return candidate.content
    .filter((part): part is { type: "text"; text: string } => {
      return Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string");
    })
    .map((part) => part.text)
    .join("\n");
}

function isAssistantMessage(message: unknown): boolean {
  return (message as GoalMessage).role === "assistant";
}

function cleanPlanItem(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\[(?:DONE|TODO):\d+\]/gi, "")
    .trim()
    .replace(/[.;]+$/, "");
}

function extractPlan(text: string): string[] {
  const lines = text.split("\n");
  const items: string[] = [];
  let inPlanSection = false;

  for (const line of lines) {
    const heading = line.match(/^#{1,4}\s*(.+)$/)?.[1]?.trim().toLowerCase();
    if (heading) {
      inPlanSection = /plan|success criteria|acceptance criteria|steps|objective/.test(heading);
      continue;
    }

    const match = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)$/);
    if (!match) {
      if (inPlanSection && line.trim() === "") continue;
      if (inPlanSection && items.length > 0 && line.trim()) inPlanSection = false;
      continue;
    }

    const item = cleanPlanItem(match[1]);
    if (item.length > 3 && !items.includes(item)) items.push(item.slice(0, 140));
    if (items.length >= 8) break;
  }

  return items;
}

function latestAssistant(messages: unknown[]): GoalMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isAssistantMessage(messages[i])) return messages[i] as GoalMessage;
  }
  return undefined;
}

function makeInitialState(goal: string): GoalState {
  const configuredMax = Number.parseInt(process.env.PI_GOAL_MAX_ITERATIONS ?? "", 10);
  const maxIterations = Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : DEFAULT_MAX_ITERATIONS;
  return {
    goal,
    status: "active",
    plan: [],
    progress: "Designing a plan and success criteria",
    iterations: 0,
    maxIterations,
    startedAt: new Date().toISOString(),
  };
}

function statusText(state: GoalState): string {
  if (state.status === "active") return `◈ goal ${state.iterations}/${state.maxIterations}`;
  if (state.status === "completed") return "✓ goal complete";
  if (state.status === "paused") return "Ⅱ goal paused";
  return "";
}

function goalWidget(state: GoalState, ctx: ExtensionContext) {
  ctx.ui.setWidget("goal-mode", (_tui, theme) => ({
    render(width: number): string[] {
      const limit = Math.max(1, width);
      const icon = state.status === "completed" ? "✓" : state.status === "paused" ? "Ⅱ" : "◈";
      const heading = `${icon} ${state.status === "completed" ? "Goal complete" : state.status === "paused" ? "Goal paused" : "Goal mode"}  ·  ${state.iterations}/${state.maxIterations}`;
      const lines = [
        theme.fg(state.status === "completed" ? "success" : state.status === "paused" ? "warning" : "accent", heading),
        theme.fg("text", `  ${state.goal}`),
        theme.fg("muted", `  ${state.progress}`),
      ];

      if (state.plan.length > 0) {
        lines.push(theme.fg("dim", "  plan: ") + state.plan.slice(0, 3).map((item, index) => `${index + 1}. ${item}`).join("  ·  "));
      }

      return lines.map((line) => truncateToWidth(line, limit, "…"));
    },
    invalidate() {},
  }));
}

export default function goalModeExtension(pi: ExtensionAPI): void {
  let state: GoalState = {
    goal: "",
    status: "idle",
    plan: [],
    progress: "",
    iterations: 0,
    maxIterations: DEFAULT_MAX_ITERATIONS,
    startedAt: "",
  };
  let currentContext: ExtensionContext | undefined;
  let continuationQueued = false;

  function persist(): void {
    pi.appendEntry(GOAL_STATE_TYPE, { ...state, plan: [...state.plan] });
  }

  function updateUi(ctx: ExtensionContext): void {
    currentContext = ctx;
    ctx.ui.setStatus("goal-mode", statusText(state) || undefined);
    if (state.status === "idle") {
      ctx.ui.setWidget("goal-mode", undefined);
    } else {
      goalWidget(state, ctx);
    }
  }

  function completeGoal(summary: string, evidence: string[], ctx: ExtensionContext): void {
    state.status = "completed";
    state.completedAt = new Date().toISOString();
    state.completionSummary = summary;
    state.progress = evidence.length > 0 ? evidence.join(" · ") : summary;
    continuationQueued = false;
    persist();
    updateUi(ctx);
  }

  function promptForGoal(): string {
    const plan = state.plan.length > 0 ? `\nCurrent designed plan:\n${state.plan.map((item, i) => `${i + 1}. ${item}`).join("\n")}` : "";
    return `[GOAL MODE ACTIVE — iteration ${state.iterations}/${state.maxIterations}]\n\nOriginal goal:\n${state.goal}\n${plan}\n\nWork autonomously toward this goal. On the first pass, design a concrete plan and explicit, verifiable success criteria. Then execute the plan using the available tools and verify each criterion yourself. Do not stop merely because you have a plan or because one step succeeded. If information is genuinely required from the user, use the question tool instead of writing a question in prose. When every criterion is verified, call goal_complete with a concise summary and concrete evidence. Never call goal_complete speculatively. If blocked, explain the blocker and the next useful action rather than claiming success.`;
  }

  function kickoffPrompt(): string {
    return "Begin working on the active goal. Design the plan and success criteria, then take the first useful action.";
  }

  function continuationPrompt(): string {
    return `Continue working on the active goal. Review the goal, your designed success criteria, and the latest tool results. Take the next useful action now; do not provide a stopping summary until the goal is verified. When all criteria pass, call goal_complete.`;
  }

  function isGeneratedGoalPrompt(message: unknown): boolean {
    const candidate = message as GoalMessage;
    return candidate.role === "user" && textFromMessage(message).startsWith("[GOAL MODE ACTIVE —");
  }

  pi.registerTool({
    name: "goal_complete",
    label: "Complete Goal",
    description: "Mark the active goal as complete only after every model-designed success criterion has been verified. Include concrete evidence.",
    promptGuidelines: [
      "Use goal_complete only when the active goal is fully verified; do not use it to end a plan early.",
    ],
    parameters: GoalCompleteParams,
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (state.status !== "active") {
        return {
          content: [{ type: "text", text: `No active goal to complete (status: ${state.status}).` }],
          details: { status: state.status },
        };
      }

      const summary = params.summary.trim();
      if (!summary) throw new Error("goal_complete requires a non-empty summary");

      const evidence = (params.evidence ?? []).map((item) => item.trim()).filter(Boolean);
      completeGoal(summary, evidence, ctx);
      ctx.ui.notify("Goal completed.", "info");

      return {
        content: [{ type: "text", text: `Goal completed: ${summary}${evidence.length ? `\nEvidence:\n- ${evidence.join("\n- ")}` : ""}` }],
        details: { status: "completed", summary, evidence },
        terminate: true,
      };
    },
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("goal_complete ")) + theme.fg("muted", args.summary), 0, 0);
    },
    renderResult(result, _options, theme) {
      return new Text(theme.fg("success", "✓ ") + theme.fg("accent", "Goal complete"), 0, 0);
    },
  });

  const handleGoalCommand = async (args: string, ctx: ExtensionContext & { waitForIdle?: () => Promise<void> }): Promise<void> => {
    const input = args.trim();
    const command = input.toLowerCase();

    if (command === "status" || command === "") {
      if (state.status === "idle") {
        ctx.ui.notify("No goal is active. Start one with /goal <objective>.", "info");
      } else {
        const plan = state.plan.length > 0 ? `\nPlan:\n${state.plan.map((item, i) => `${i + 1}. ${item}`).join("\n")}` : "";
        ctx.ui.notify(`${statusText(state)}\n${state.goal}\n${state.progress}${plan}`, "info");
      }
      return;
    }

    if (command === "stop" || command === "pause") {
      if (state.status === "active") {
        state.status = "paused";
        state.progress = "Paused by user";
        persist();
        ctx.abort();
        updateUi(ctx);
        ctx.ui.notify("Goal mode paused. Use /goal resume to continue.", "warning");
      }
      return;
    }

    if (command === "resume" || command === "continue") {
      if (state.status !== "paused") {
        ctx.ui.notify(`Cannot resume a goal with status: ${state.status}`, "warning");
        return;
      }
      state.status = "active";
      state.progress = "Resuming work";
      continuationQueued = false;
      persist();
      updateUi(ctx);
      pi.sendUserMessage(continuationPrompt());
      return;
    }

    if (command === "clear" || command === "reset") {
      state = makeInitialState("");
      state.status = "idle";
      continuationQueued = false;
      persist();
      updateUi(ctx);
      ctx.ui.notify("Goal state cleared.", "info");
      return;
    }

    if (typeof ctx.waitForIdle === "function") await ctx.waitForIdle();
    state = makeInitialState(input);
    continuationQueued = false;
    persist();
    updateUi(ctx);
    pi.sendUserMessage(kickoffPrompt());
  };

  pi.registerCommand("goal", {
    description: "Start, pause, resume, or inspect autonomous goal mode",
    handler: handleGoalCommand,
  });
  pi.registerCommand("goal-mode", {
    description: "Alias for /goal",
    handler: handleGoalCommand,
  });

  pi.registerShortcut(Key.ctrlAlt("g"), {
    description: "Pause or resume goal mode",
    handler: async (ctx) => {
      if (state.status === "active") {
        state.status = "paused";
        state.progress = "Paused by user";
        persist();
        ctx.abort();
        updateUi(ctx);
        return;
      }
      if (state.status === "paused") {
        state.status = "active";
        state.progress = "Resuming work";
        continuationQueued = false;
        persist();
        updateUi(ctx);
        pi.sendUserMessage(continuationPrompt());
      }
    },
  });

  pi.on("session_start", (_event, ctx) => {
    currentContext = ctx;
    const entry = [...ctx.sessionManager.getBranch()]
      .reverse()
      .find((candidate) => candidate.type === "custom" && (candidate as GoalStateEntry).customType === GOAL_STATE_TYPE) as GoalStateEntry | undefined;
    if (entry?.data?.goal && entry.data.status !== "idle") {
      state = {
        ...state,
        ...entry.data,
        plan: [...(entry.data.plan ?? [])],
      };
    }
    continuationQueued = false;
    updateUi(ctx);
  });

  pi.on("agent_start", (_event, ctx) => {
    currentContext = ctx;
    continuationQueued = false;
    updateUi(ctx);
  });

  pi.on("before_agent_start", async (event) => {
    const result: {
      systemPrompt: string;
      message?: { customType: string; content: string; display: false };
    } = {
      systemPrompt: `${event.systemPrompt}\n\n${GOAL_CAPABILITY_PROMPT}`,
    };
    if (state.status === "active") {
      result.message = {
        customType: GOAL_CONTEXT_TYPE,
        content: promptForGoal(),
        display: false,
      };
    }
    return result;
  });

  pi.on("context", async (event) => {
    const goalMessages = event.messages.filter(
      (message) => (message as GoalMessage).customType === GOAL_CONTEXT_TYPE,
    );
    const generatedPrompts = event.messages.filter(isGeneratedGoalPrompt);
    if (goalMessages.length <= 1 && generatedPrompts.length === 0) return;

    let latestIndex = -1;
    for (let i = event.messages.length - 1; i >= 0; i--) {
      if ((event.messages[i] as GoalMessage).customType === GOAL_CONTEXT_TYPE) {
        latestIndex = i;
        break;
      }
    }
    return {
      messages: event.messages.filter((message, index) => {
        if (isGeneratedGoalPrompt(message)) return false;
        return (message as GoalMessage).customType !== GOAL_CONTEXT_TYPE || index === latestIndex;
      }),
    };
  });

  pi.on("turn_end", async (event, ctx) => {
    if (state.status !== "active" || !isAssistantMessage(event.message)) return;
    const text = textFromMessage(event.message);
    const extracted = extractPlan(text);
    if (state.plan.length === 0 && extracted.length > 0) state.plan = extracted;
    if (text.trim()) state.progress = text.trim().replace(/\s+/g, " ").slice(-220);
    persist();
    updateUi(ctx);
  });

  pi.on("agent_end", async (event, ctx) => {
    if (state.status !== "active") return;

    const last = latestAssistant(event.messages);
    const text = last ? textFromMessage(last) : "";
    const extracted = extractPlan(text);
    if (state.plan.length === 0 && extracted.length > 0) state.plan = extracted;

    if (/\[GOAL_COMPLETE\]/i.test(text)) {
      completeGoal(text.replace(/\[GOAL_COMPLETE\]/gi, "").trim(), [], ctx);
      return;
    }

    if (last?.stopReason === "aborted" || last?.stopReason === "error") {
      state.status = "paused";
      state.progress = `Paused after ${last.stopReason}`;
      persist();
      updateUi(ctx);
      return;
    }

    if (state.iterations >= state.maxIterations) {
      state.status = "paused";
      state.progress = `Iteration limit reached (${state.maxIterations})`;
      persist();
      updateUi(ctx);
      ctx.ui.notify("Goal mode paused at its iteration limit. Use /goal resume to continue.", "warning");
      return;
    }

    if (continuationQueued || ctx.hasPendingMessages()) return;

    state.iterations += 1;
    state.progress = "Continuing toward the next unverified criterion";
    continuationQueued = true;
    persist();
    updateUi(ctx);
    pi.sendUserMessage(continuationPrompt(), { deliverAs: "followUp" });
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (state.status === "active") persist();
    ctx.ui.setStatus("goal-mode", undefined);
    ctx.ui.setWidget("goal-mode", undefined);
    currentContext = undefined;
  });

  void currentContext;
}
