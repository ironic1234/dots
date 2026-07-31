import { isAbsolute, resolve } from "node:path";
import { isToolCallEventType, type ExtensionAPI, type ToolCallEvent } from "@earendil-works/pi-coding-agent";

type Risk = {
  category: string;
  detail: string;
};

const SAFETY_CAPABILITY = "[SAFETY CAPABILITY] A default-on permission gate protects destructive shell, Git, deployment, and sensitive-file actions. Normal coding edits do not need confirmation; denied dangerous actions must not be retried without approval.";

function shellRisk(command: string): Risk | undefined {
  const checks: Array<[RegExp, string]> = [
    [/(^|[;&|\n]\s*)(?:command\s+)?rm(?:\s+(?:--?[A-Za-z][A-Za-z-]*|--))*\s+\S+/i, "file deletion"],
    [/(^|[;&|\n]\s*)(?:command\s+)?rmdir\s+/i, "directory deletion"],
    [/(^|[;&|\n]\s*)git\s+(?:-C\s+\S+\s+)?(?:reset\s+--hard|clean\s+-[^\n]*f|checkout\s+--|restore\s+--worktree|branch\s+-D|rebase\s+)/i, "destructive Git operation"],
    [/(^|[;&|\n]\s*)git\s+(?:-C\s+\S+\s+)?push(?:\s|$)/i, "remote Git write"],
    [/(^|[;&|\n]\s*)git\s+(?:-C\s+\S+\s+)?commit(?:\s|$)/i, "Git history write"],
    [/(^|[;&|\n]\s*)(?:find\s+[^\n]*\s-delete|(?:xargs|parallel)\s+[^\n]*\b(?:rm|rmdir)\b)/i, "file deletion"],
    [/(^|[;&|\n]\s*)(?:docker\s+compose\s+(?:down|rm|up)|docker\s+(?:run|system\s+prune|rm)|kubectl\s+(?:apply|delete|replace)|helm\s+(?:install|upgrade|uninstall)|terraform\s+(?:apply|destroy)|pulumi\s+(?:up|destroy)|systemctl\s+(?:start|stop|restart|enable|disable))/i, "deployment or infrastructure change"],
    [/(^|[;&|\n]\s*)(?:npm|pnpm|yarn|bun)\s+publish(?:\s|$)/i, "package publication"],
    [/(^|[;&|\n]\s*)rsync\s+[^\n]*--delete/i, "synchronized deletion"],
    [/(?:curl|wget)\s+[^\n|]*\|\s*(?:sh|bash|zsh|sudo)/i, "remote script execution"],
    [/(^|[;&|\n]\s*)sudo\s+/i, "privileged command"],
    [/(^|[;&|\n]\s*)chmod\s+(?:-R\s+)?(?:777|666)\b/i, "unsafe permission change"],
  ];

  const match = checks.find(([pattern]) => pattern.test(command));
  return match ? { category: match[1], detail: command.trim().slice(0, 800) } : undefined;
}

function pathRisk(pathValue: unknown, cwd: string): Risk | undefined {
  if (typeof pathValue !== "string" || !pathValue.trim()) return undefined;
  const path = pathValue.trim();
  const absolute = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  const relative = absolute.startsWith(`${cwd}/`) ? absolute.slice(cwd.length + 1) : undefined;
  const sensitive = /(^|\/)(?:\.env(?:\.|$)|\.ssh(?:\/|$)|\.aws(?:\/|$)|credentials?\b|secrets?\b|oauth\.json$|id_rsa(?:\.pub)?$|settings\.json$|trust\.json$)/i.test(absolute);
  if (!relative || sensitive) {
    return {
      category: sensitive ? "sensitive file change" : "file change outside the workspace",
      detail: absolute,
    };
  }
  return undefined;
}

function customRisk(event: ToolCallEvent): Risk | undefined {
  if (["bash", "read", "write", "edit", "grep", "find", "ls"].includes(event.toolName)) return undefined;
  if (/(?:delete|destroy|deploy|publish|withdraw|transfer|close)/i.test(event.toolName)) {
    return { category: "high-impact tool", detail: event.toolName };
  }
  return undefined;
}

function riskFor(event: ToolCallEvent, cwd: string): Risk | undefined {
  if (isToolCallEventType("bash", event)) return shellRisk(event.input.command);
  if (isToolCallEventType("write", event)) return pathRisk(event.input.path, cwd);
  if (isToolCallEventType("edit", event)) return pathRisk(event.input.path, cwd);
  return customRisk(event);
}

export default function safetyGateExtension(pi: ExtensionAPI): void {
  let enabled = true;

  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${SAFETY_CAPABILITY}`,
  }));

  pi.registerCommand("safety", {
    description: "Inspect or change the destructive-action permission gate",
    handler: async (args, ctx) => {
      const command = args.trim().toLowerCase();
      if (!command || command === "status") {
        ctx.ui.notify(`Safety gate: ${enabled ? "on" : "off"}`, enabled ? "info" : "warning");
        return;
      }
      if (command === "on") {
        enabled = true;
        ctx.ui.notify("Safety gate enabled.", "info");
        return;
      }
      if (command === "off") {
        if (!await ctx.ui.confirm("Disable safety gate?", "Destructive tools will run without confirmation until the session reloads.")) return;
        enabled = false;
        ctx.ui.notify("Safety gate disabled for this session.", "warning");
        return;
      }
      ctx.ui.notify("Usage: /safety [status|on|off]", "info");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setStatus("safety-gate", enabled ? "safety on" : "safety off");
  });
  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setStatus("safety-gate", undefined);
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!enabled) return;
    const risk = riskFor(event, ctx.cwd);
    if (!risk) return;

    const detail = `${risk.category}\n\n${risk.detail}`;
    if (!ctx.hasUI) {
      return { block: true, reason: `Blocked ${risk.category}: interactive approval is unavailable.` };
    }

    const approved = await ctx.ui.confirm(`Approve ${risk.category}?`, detail, {
      signal: ctx.signal,
      timeout: 120_000,
    });
    if (!approved) return { block: true, reason: `User denied ${risk.category}.` };
  });
}
