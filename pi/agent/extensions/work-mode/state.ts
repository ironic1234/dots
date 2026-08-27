/**
 * Shared state and policy for the main session's subagent work modes.
 *
 * This module is imported by the work-mode extension. Keeping the policy
 * separate makes it possible for the extension and its tests to share one
 * source of truth without loading the full subagent tool implementation.
 */

export type WorkMode = "orchestration" | "build";

export const DEFAULT_WORK_MODE: WorkMode = "build";
export const WORK_MODE_ENTRY_TYPE = "subagent-work-mode";
export const ORCHESTRATION_MODEL_ID = "openai-codex/gpt-5.6-sol";
export const SUBAGENT_LAUNCH_TOOL = "subagent";
export const SUBAGENT_AUXILIARY_TOOLS = ["subagent_status", "subagent_wait"] as const;

let currentWorkMode: WorkMode = DEFAULT_WORK_MODE;

export function getWorkMode(): WorkMode {
	return currentWorkMode;
}

export function setWorkMode(mode: WorkMode): void {
	currentWorkMode = mode;
}

export function parseWorkMode(value: unknown): WorkMode | undefined {
	return value === "orchestration" || value === "build" ? value : undefined;
}

/**
 * Build mode removes only the launch tool so existing background runs can
 * still be inspected or awaited. The work-mode extension also blocks launch
 * calls at runtime for stale tool lists or an already-streaming turn.
 */
export function activeToolsForMode(mode: WorkMode, activeTools: string[]): string[] {
	const active = [...new Set(activeTools)];
	if (mode === "build") return active.filter((name) => name !== SUBAGENT_LAUNCH_TOOL);

	return [...new Set([...active, SUBAGENT_LAUNCH_TOOL, ...SUBAGENT_AUXILIARY_TOOLS])];
}

export function modePrompt(mode: WorkMode): string {
	if (mode === "orchestration") {
		return [
			"## ORCHESTRATION MODE ACTIVE — DELEGATE BY DEFAULT",
			"The main session is pinned to openai-codex/gpt-5.6-sol at low thinking.",
			"You are the orchestration layer, not the implementation worker.",
			"Before using direct repository tools, consider delegation first. Use the `subagent` tool aggressively for any non-trivial research, planning, implementation, or review; do not do substantial repository work directly when a focused subagent can do it.",
			"Decompose work into explicit tasks. Prefer scout/planner → worker → reviewer; use parallel tasks for independent work and chains with `{previous}` for dependent work.",
			"Use `keepSession` for follow-ups, set budgets and tool/cwd allowlists deliberately, inspect every result status, and route partial or failed work to another focused subagent.",
			"Keep the main context focused on coordination and synthesis. When delegation is useful, use `background:true` and monitor with `subagent_status`/`subagent_wait` rather than idling.",
		].join("\n");
	}

	return [
		"## BUILD MODE ACTIVE — WORK DIRECTLY",
		"Work directly in this main session using the currently selected model and available local tools.",
		"Do not call the `subagent` launch tool, do not delegate work, and do not attempt to create background or chained subagent runs. Build mode blocks subagent launches at runtime.",
		"Read, edit, validate, and finish the assigned implementation yourself unless the user explicitly changes to `/mode orchestration`.",
	].join("\n");
}

export function canLaunchSubagents(mode: WorkMode): boolean {
	return mode === "orchestration";
}
