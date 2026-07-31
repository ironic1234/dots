import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";

type UsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
};

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function collectUsage(ctx: ExtensionContext): UsageTotals {
  const totals: UsageTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
  };

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;

    const message = entry.message as {
      role?: string;
      usage?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
        cost?: { total?: number };
      };
    };
    const usage = message.usage;
    if (!usage) continue;

    totals.input += numberOrZero(usage.input);
    totals.output += numberOrZero(usage.output);
    totals.cacheRead += numberOrZero(usage.cacheRead);
    totals.cacheWrite += numberOrZero(usage.cacheWrite);
    totals.cost += numberOrZero(usage.cost?.total);
  }

  return totals;
}

function formatCount(value: number): string {
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

function formatCost(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(3)}`;
}

function formatPath(path: string): string {
  const home = homedir();
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  return path;
}

function contextLabel(ctx: ExtensionContext): string {
  const usage = ctx.getContextUsage();
  if (!usage || usage.tokens === null) return "ctx —";
  const percent = usage.percent === null ? "—" : `${usage.percent.toFixed(0)}%`;
  return `ctx ${formatCount(usage.tokens)}/${formatCount(usage.contextWindow)} ${percent}`;
}

function renderFrame(width: number, content: string, theme: ExtensionContext["ui"]["theme"]): string {
  const renderWidth = Math.max(1, width);
  if (renderWidth < 8) return truncateToWidth(content, renderWidth, "");

  const left = theme.fg("borderMuted", "│ ");
  const right = theme.fg("borderMuted", " │");
  const available = Math.max(1, renderWidth - visibleWidth(left) - visibleWidth(right));
  const body = truncateToWidth(content, available, "…");
  const padding = " ".repeat(Math.max(0, available - visibleWidth(body)));
  return truncateToWidth(`${left}${body}${padding}${right}`, renderWidth, "");
}

export default function footerExtension(pi: ExtensionAPI): void {
  let requestRender = (): void => {};

  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n[FOOTER CAPABILITY] A compact UI footer is active and displays model, context, usage, cost, branch, tool, and extension-status information. It requires no model action.`,
  }));

  function refresh(): void {
    requestRender();
  }

  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      const unsubscribe = footerData.onBranchChange(requestRender);

      return {
        render(width: number): string[] {
          const usage = collectUsage(ctx);
          const branch = footerData.getGitBranch();
          const sessionName = pi.getSessionName();
          const activeTools = pi.getActiveTools().length;
          const allTools = pi.getAllTools().length;
          const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no model";
          const thinking = ctx.thinkingLevel ?? pi.getThinkingLevel();
          const statuses = [...footerData.getExtensionStatuses().values()].filter(Boolean).slice(0, 2);
          const working = !ctx.isIdle();

          const project = formatPath(ctx.cwd);
          const location = branch ? `${project}  ${theme.fg("accent", `⎇ ${branch}`)}` : project;
          const title = sessionName ? `${theme.fg("text", sessionName)}  ·  ` : "";
          const statusText = statuses.length > 0 ? `  ${statuses.join("  ")}` : "";

          const top =
            theme.fg("accent", theme.bold("✦ pi")) +
            "  " +
            title +
            theme.fg("muted", location) +
            (working ? `  ${theme.fg("warning", "● working")}` : "") +
            statusText;

          const bottom =
            theme.fg("muted", `↑${formatCount(usage.input)} ↓${formatCount(usage.output)}`) +
            "  " +
            theme.fg("dim", `cache ${formatCount(usage.cacheRead)}/${formatCount(usage.cacheWrite)}`) +
            "  " +
            theme.fg("success", formatCost(usage.cost)) +
            "  " +
            theme.fg("dim", contextLabel(ctx)) +
            "  " +
            theme.fg("dim", `tools ${activeTools}/${allTools}`) +
            "  " +
            theme.fg("text", model) +
            "  " +
            theme.fg("accent", thinking);

          return [
            renderFrame(width, top, theme),
            renderFrame(width, bottom, theme),
          ];
        },
        invalidate() {},
        dispose: unsubscribe,
      };
    });

    refresh();
  });

  pi.on("session_info_changed", refresh);
  pi.on("model_select", refresh);
  pi.on("thinking_level_select", refresh);
  pi.on("agent_start", refresh);
  pi.on("agent_end", refresh);
  pi.on("turn_end", refresh);
  pi.on("tool_execution_start", refresh);
  pi.on("tool_execution_end", refresh);

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setFooter(undefined);
    requestRender = () => {};
  });

}
