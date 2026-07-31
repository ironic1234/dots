import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CAPABILITY_DIRECTORY = `[PI CAPABILITY DIRECTORY]
These capabilities are available in this Pi session:
- Persistent memory: use the memory tool with action=retrieve to search stored memories; use create or edit to manage them. Memory contents are not loaded automatically.
- User questions: use the question tool when required information or a user decision is genuinely missing.
- Autonomous goals: the user can start /goal <objective>; while goal mode is active, work until every designed criterion is verified and finish with goal_complete.
- Robinhood: use robinhood_search_tools to search and load only the brokerage capability needed for the current task. Do not expect every Robinhood schema to be active initially.
- Code intelligence: use the LSP tools when language-server definitions, references, hover information, symbols, or diagnostics are needed.
- Footer: the footer is a UI-only status display with model, context, usage, cost, branch, and active-tool information.
[/PI CAPABILITY DIRECTORY]`;

export default function capabilitiesExtension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${CAPABILITY_DIRECTORY}`,
  }));
}
