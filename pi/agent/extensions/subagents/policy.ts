/**
 * Runtime policy for the bundled named agents.
 *
 * Agent markdown files make these defaults discoverable, but the extension
 * applies this table after request parsing so callers cannot override the
 * controls for these four roles. Inline and other custom agents remain fully
 * configurable.
 */

export interface AgentControls {
	model?: string;
	tools?: string[];
	thinking?: string;
	timeoutSec?: number;
	maxTurns?: number;
}

export interface EnforcedAgentProfile {
	readonly model: string;
	readonly tools: readonly string[];
	readonly thinking: string;
	readonly timeoutSec: number;
	readonly maxTurns: number;
}

export const ENFORCED_AGENT_PROFILES: Readonly<Record<string, EnforcedAgentProfile>> = {
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
};

/**
 * Apply a named profile with profile values taking precedence over every
 * caller-supplied control. A fresh tools array prevents accidental mutation
 * of the policy table by downstream code.
 */
export function applyAgentPolicy(name: string | undefined, controls: AgentControls): AgentControls {
	const profile = name ? ENFORCED_AGENT_PROFILES[name] : undefined;
	if (!profile) return controls;

	return {
		...controls,
		model: profile.model,
		thinking: profile.thinking,
		tools: [...profile.tools],
		timeoutSec: profile.timeoutSec,
		maxTurns: profile.maxTurns,
	};
}
