/**
 * Subagents — TUI views.
 *
 * - Live run state (activities, usage, thinking preview) shared with index.ts
 * - Live dashboard rendered into the tool result while subagents run
 * - Full per-run transcript rendering for finished runs
 * - Interactive `/subagents` browser overlay (list + scrollable detail)
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	Key,
	Markdown,
	matchesKey,
	sliceByColumn,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
	type MarkdownTheme,
} from "@earendil-works/pi-tui";
import { getFinalOutput, type SubagentRunResult, type SubagentUsage } from "./runner.ts";

// ---------------------------------------------------------------------------
// Live run state (written by index.ts, read by the views below)
// ---------------------------------------------------------------------------

export interface RunActivity {
	kind: "thinking" | "message" | "tool" | "toolResult" | "status";
	/** ms since run start */
	at: number;
	text?: string;
	toolName?: string;
	argsPreview?: string;
	resultPreview?: string;
	isError?: boolean;
}

export interface LiveRun {
	runId: string;
	groupId: string;
	kind: "single" | "parallel" | "chain";
	step?: number;
	name: string;
	model: string;
	task: string;
	status: "running" | "ok" | "error";
	/** epoch ms */
	startTime: number;
	endTime?: number;
	usage: SubagentUsage;
	activities: RunActivity[];
	currentThinking?: string;
	messages: AgentMessage[];
	stopReason?: string;
	errorMessage?: string;
	sessionId?: string;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

export function formatElapsed(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const m = Math.floor(ms / 60_000);
	const s = Math.round((ms % 60_000) / 1000);
	return `${m}m${s}s`;
}

export function usageLine(usage: SubagentUsage, model?: string): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens) parts.push(`ctx ${formatTokens(usage.contextTokens)}`);
	if (model) parts.push(model);
	return parts.join(" · ");
}

export function preview(text: string, max = 60): string {
	const t = text.replace(/\s+/g, " ").trim();
	return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function statusIcon(status: "running" | "ok" | "error"): string {
	return status === "running" ? "⏳" : status === "ok" ? "✓" : "✗";
}

export function truncateBytes(text: string, cap: number): string {
	if (Buffer.byteLength(text, "utf8") <= cap) return text;
	let truncated = text.slice(0, cap);
	while (Buffer.byteLength(truncated, "utf8") > cap) truncated = truncated.slice(0, -1);
	return `${truncated}… [truncated]`;
}

export function isFailedResult(r: SubagentRunResult): boolean {
	return r.exitCode !== 0 || r.stopReason === "error" || r.stopReason === "aborted" || r.stopReason === "timeout" || r.stopReason === "maxTurns";
}

export function runDisplayName(r: { kind: "single" | "parallel" | "chain"; step?: number; name: string }): string {
	return r.kind === "single" ? r.name : `${r.kind}${r.step !== undefined ? ` ${r.step}` : ""} · ${r.name}`;
}

// ---------------------------------------------------------------------------
// Activity lines
// ---------------------------------------------------------------------------

export function activityLine(a: RunActivity, theme: Theme): string {
	switch (a.kind) {
		case "tool":
			return `  ${theme.fg("toolTitle", `🔧 ${a.toolName}`)} ${theme.fg("dim", a.argsPreview ?? "")}`;
		case "toolResult":
			if (a.isError) {
				return `  ${theme.fg("error", `✗ ${a.toolName}`)}${a.resultPreview ? ` ${theme.fg("error", preview(a.resultPreview, 90))}` : ""}`;
			}
			return `  ${theme.fg("success", `✓ ${a.toolName}`)}${a.resultPreview ? ` ${theme.fg("dim", preview(a.resultPreview, 90))}` : ""}`;
		case "message":
			return `  ${theme.fg("accent", "💬")} ${theme.fg("dim", preview(a.text ?? "", 110))}`;
		case "thinking":
			return `  ${theme.fg("thinkingLow", `💭 ${preview(a.text ?? "", 110)}`)}`;
		case "status":
			return `  ${theme.fg("warning", a.text ?? "")}`;
	}
}

/** Plain (no ANSI) one-liner for the last activity — used for onUpdate content text. */
export function activityPlainText(a: RunActivity): string {
	switch (a.kind) {
		case "tool":
			return `→ ${a.toolName} ${a.argsPreview ?? ""}`.trimEnd();
		case "toolResult":
			return `${a.isError ? "✗" : "✓"} ${a.toolName}${a.resultPreview ? ` ${preview(a.resultPreview, 90)}` : ""}`;
		case "message":
			return `💬 ${preview(a.text ?? "", 100)}`;
		case "thinking":
			return `💭 ${preview(a.text ?? "", 100)}`;
		case "status":
			return a.text ?? "";
	}
}

// ---------------------------------------------------------------------------
// Transcript segments (shared by Container renderer and browser plain lines)
// ---------------------------------------------------------------------------

type TranscriptSegment =
	| { type: "text"; turn: number; text: string }
	| { type: "thinking"; turn: number; text: string }
	| { type: "toolCall"; turn: number; name: string; args: string }
	| { type: "toolResult"; turn: number; name: string; args: string; text: string; isError: boolean };

function textOf(content: Array<{ type?: string; text?: string }>): string {
	return (content ?? [])
		.filter((c): c is { type: "text"; text: string } => c?.type === "text" && typeof c.text === "string")
		.map((c) => c.text)
		.join("\n");
}

export function messageSegments(messages: AgentMessage[]): TranscriptSegment[] {
	const segments: TranscriptSegment[] = [];
	const pending = new Map<string, { name: string; args: string }>();
	let turn = 0;
	for (const m of messages) {
		if (m.role === "assistant") {
			turn++;
			for (const part of m.content) {
				if (part.type === "text" && part.text.trim()) {
					segments.push({ type: "text", turn, text: part.text });
				} else if (part.type === "thinking" && part.thinking?.trim()) {
					segments.push({ type: "thinking", turn, text: part.thinking });
				} else if (part.type === "toolCall") {
					const args = preview(JSON.stringify(part.arguments), 140);
					pending.set(part.id, { name: part.name, args });
					segments.push({ type: "toolCall", turn, name: part.name, args });
				}
			}
		} else if (m.role === "toolResult") {
			const call = m.toolCallId ? pending.get(m.toolCallId) : undefined;
			if (call) pending.delete(m.toolCallId);
			segments.push({
				type: "toolResult",
				turn,
				name: call?.name ?? m.toolName,
				args: call?.args ?? "",
				text: textOf(m.content as Array<{ type?: string; text?: string }>),
				isError: m.isError,
			});
		}
	}
	return segments;
}

function runHeaderLine(r: SubagentRunResult, theme: Theme): string {
	const icon = isFailedResult(r) ? "✗" : "✓";
	const stop = r.stopReason ? ` ${theme.fg("warning", `[${r.stopReason}]`)}` : "";
	return `${icon} ${theme.fg("accent", r.name)}${stop} · ${theme.fg("dim", r.model)} · ${theme.fg("dim", formatElapsed(r.durationMs ?? 0))}`;
}

function appendSegment(container: Container, seg: TranscriptSegment, mdTheme: MarkdownTheme, theme: Theme): void {
	switch (seg.type) {
		case "text":
			container.addChild(new Spacer(1));
			container.addChild(new Markdown(truncateBytes(seg.text, 6000), 0, 0, mdTheme));
			break;
		case "thinking":
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("thinkingLow", `💭 ${truncateBytes(seg.text, 2000)}`), 0, 0));
			break;
		case "toolCall":
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("toolTitle", `🔧 ${seg.name}`) + (seg.args ? ` ${theme.fg("dim", seg.args)}` : ""), 0, 0));
			break;
		case "toolResult":
			container.addChild(new Text(seg.isError ? theme.fg("error", `✗ ${seg.name}`) : theme.fg("success", `✓ ${seg.name}`), 0, 0));
			if (seg.text) container.addChild(new Text(theme.fg("toolOutput", truncateBytes(seg.text, 4000)), 1, 0));
			break;
	}
}

// ---------------------------------------------------------------------------
// Live dashboard (streamed into the tool result while subagents run)
// ---------------------------------------------------------------------------

export function renderLiveDashboard(live: LiveRun[], expanded: boolean, theme: Theme): Component {
	const container = new Container();
	const running = live.filter((r) => r.status === "running").length;
	const totalCost = live.reduce((s, r) => s + r.usage.cost, 0);
	const header = `Subagents · ${live.length} run${live.length === 1 ? "" : "s"} · ${running} active · $${totalCost.toFixed(4)}${expanded ? "" : "  (Ctrl+O to expand)"}`;
	container.addChild(new Text(theme.fg("accent", header), 0, 0));

	for (const r of live) {
		container.addChild(new Spacer(1));
		const icon = statusIcon(r.status);
		const color: "accent" | "success" | "error" = r.status === "running" ? "accent" : r.status === "ok" ? "success" : "error";
		const elapsed = formatElapsed((r.status === "running" ? Date.now() : r.endTime ?? Date.now()) - r.startTime);
		const stop = r.stopReason && r.status !== "running" ? ` ${theme.fg("warning", `[${r.stopReason}]`)}` : "";
		container.addChild(
			new Text(`${icon} ${theme.fg(color, runDisplayName(r))}${stop} · ${theme.fg("dim", r.model)} · ${theme.fg("dim", elapsed)}`, 0, 0),
		);
		container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", preview(r.task, 110)), 0, 0));
		if (r.currentThinking) {
			container.addChild(new Text(theme.fg("thinkingLow", `  💭 ${preview(r.currentThinking, 130)}`), 0, 0));
		}
		const recent = r.activities.slice(-(expanded ? 10 : 2));
		for (const a of recent) {
			container.addChild(new Text(activityLine(a, theme), 0, 0));
		}
		const u = usageLine(r.usage, r.model);
		if (u) container.addChild(new Text(theme.fg("dim", `  ${u}`), 0, 0));
	}
	return container;
}

/** Plain-text variant of the dashboard for onUpdate content. */
export function liveDashboardText(live: LiveRun[]): string {
	const lines: string[] = [];
	for (const r of live) {
		const icon = statusIcon(r.status);
		const elapsed = formatElapsed((r.status === "running" ? Date.now() : r.endTime ?? Date.now()) - r.startTime);
		lines.push(`${icon} ${runDisplayName(r)} [${r.model}] ${elapsed}`);
		if (r.currentThinking) lines.push(`   💭 ${preview(r.currentThinking, 100)}`);
		const last = r.activities[r.activities.length - 1];
		if (last) lines.push(`   ${activityPlainText(last)}`);
		const u = usageLine(r.usage);
		if (u) lines.push(`   ${u}`);
	}
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Final results view (renderResult after the tool completes)
// ---------------------------------------------------------------------------

export function renderRunResults(results: SubagentRunResult[], mode: string, expanded: boolean, theme: Theme): Component {
	const container = new Container();
	const mdTheme = getMarkdownTheme();
	const ok = results.filter((r) => !isFailedResult(r)).length;
	const totalCost = results.reduce((s, r) => s + r.usage.cost, 0);
	const header = `Subagents · ${mode} · ${ok}/${results.length} ok · $${totalCost.toFixed(4)}`;
	container.addChild(new Text(theme.fg("accent", header), 0, 0));

	for (const r of results) {
		container.addChild(new Spacer(1));
		container.addChild(new Text(runHeaderLine(r, theme), 0, 0));
		container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", preview(r.task, 120)), 0, 0));
		if (isFailedResult(r) && r.errorMessage) {
			container.addChild(new Text(theme.fg("error", r.errorMessage), 0, 0));
		}
		if (expanded) {
			let lastTurn = 0;
			for (const seg of messageSegments(r.messages)) {
				if (seg.turn && seg.turn !== lastTurn) {
					container.addChild(new Text(theme.fg("borderMuted", `  ── turn ${seg.turn} ───────────────────`), 0, 0));
					lastTurn = seg.turn;
				}
				appendSegment(container, seg, mdTheme, theme);
			}
		}
		const final = getFinalOutput(r.messages);
		if (final) {
			container.addChild(new Spacer(1));
			if (expanded) container.addChild(new Text(theme.fg("muted", "Final output:"), 0, 0));
			container.addChild(new Markdown(truncateBytes(final, 8000), 0, 0, mdTheme));
		} else if (!expanded && isFailedResult(r)) {
			container.addChild(new Text(theme.fg("error", r.stderr || "(no output)"), 0, 0));
		}
		const u = usageLine(r.usage, r.model);
		if (u) container.addChild(new Text(theme.fg("dim", u), 0, 0));
	}
	if (!expanded) container.addChild(new Text(theme.fg("muted", "(Ctrl+O to expand — full transcript, tool calls and results)"), 0, 0));
	return container;
}

// ---------------------------------------------------------------------------
// Interactive /subagents browser
// ---------------------------------------------------------------------------

const BROWSER_MAX_ROWS = 30;
const BROWSER_PAGE = 20;
const BROWSER_DETAIL_ROWS = 34;
const BROWSER_DETAIL_CAP = 40_000;

/** Background roles used for the browser panel (subset of pi's ThemeBg). */
type PanelBg = "selectedBg" | "customMessageBg" | "toolPendingBg";

/** A rendered detail row: code rows keep full width and scroll horizontally; others wrap. */
type BodyLine = { text: string; code: boolean };

function transcriptBodyLines(messages: AgentMessage[], theme: Theme, width: number, capChars: number): BodyLine[] {
	const lines: BodyLine[] = [];
	let lastTurn = 0;
	let budget = capChars;
	const innerWidth = Math.max(1, width - 2);
	// code rows are never wrapped or truncated (they scroll horizontally); prose rows wrap.
	const pushStyled = (styled: string, code: boolean) => {
		if (code) {
			lines.push({ text: styled, code: true });
		} else {
			for (const l of wrapTextWithAnsi(styled, innerWidth)) lines.push({ text: l, code: false });
		}
	};
	for (const seg of messageSegments(messages)) {
		if (budget <= 0) {
			lines.push({ text: theme.fg("dim", "  … transcript truncated"), code: false });
			break;
		}
		if (seg.turn && seg.turn !== lastTurn) {
			lines.push({ text: theme.fg("borderMuted", `  ── turn ${seg.turn} ───────────────────`), code: false });
			lastTurn = seg.turn;
		}
		switch (seg.type) {
			case "text": {
				const t = truncateBytes(seg.text, 4000);
				budget -= t.length;
				for (const l of t.split("\n")) pushStyled(`  💬 ${l}`, false);
				break;
			}
			case "thinking":
				for (const l of truncateBytes(seg.text, 1500).split("\n")) {
					pushStyled(theme.fg("thinkingLow", `  💭 ${l}`), false);
				}
				break;
			case "toolCall":
				pushStyled(`  ${theme.fg("toolTitle", `🔧 ${seg.name}`)} ${theme.fg("dim", seg.args)}`, true);
				break;
			case "toolResult": {
				lines.push({ text: seg.isError ? theme.fg("error", `  ✗ ${seg.name}`) : theme.fg("success", `  ✓ ${seg.name}`), code: false });
				if (seg.text) {
					const t = truncateBytes(seg.text, 3000);
					budget -= t.length;
					for (const l of t.split("\n")) pushStyled(theme.fg("toolOutput", `    ${l}`), true);
				}
				break;
			}
		}
	}
	return lines;
}

export class SubagentsBrowser implements Component {
	private view: "list" | "detail" = "list";
	private selected = 0;
	private detailRunId?: string;
	private scroll = 0;
	private scrollX = 0;
	private timer: ReturnType<typeof setInterval> | null = null;
	private cachedWidth = 0;
	private cachedLines: string[] = [];

	constructor(
		private theme: Theme,
		private tui: { requestRender(): void },
		private onClose: () => void,
		private getRuns: () => LiveRun[],
	) {
		// Live refresh while any subagent is running.
		this.timer = setInterval(() => {
			if (this.getRuns().some((r) => r.status === "running")) {
				this.invalidate();
				this.tui.requestRender();
			}
		}, 500);
	}

	dispose(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	invalidate(): void {
		this.cachedWidth = 0;
		this.cachedLines = [];
	}

	/** Dark panel fill (mantle) — darker than the session base so the overlay reads as a distinct window. */
	private static readonly PANEL_BG: PanelBg = "toolPendingBg";

	/** One content row: │ interior │, full-width bg so the box interior is solid. */
	private boxed(content: string, width: number, bg: PanelBg = SubagentsBrowser.PANEL_BG): string {
		const inner = truncateToWidth(content, Math.max(0, width - 2), "...", true);
		// truncateToWidth emits full resets (\x1b[0m) around the ellipsis; neutralize them
		// to a fg-only reset so the panel background survives on the trailing characters.
		const clean = inner.replace(/\x1b\[0m/g, "\x1b[39m");
		return this.theme.bg(bg, `${this.theme.fg("border", "│")}${clean}${this.theme.fg("border", "│")}`);
	}

	/** Top (╭─╮) or bottom (╰─╯) border row of the box. */
	private boxBorder(width: number, top: boolean): string {
		const l = top ? "╭" : "╰";
		const r = top ? "╮" : "╯";
		const mid = "─".repeat(Math.max(0, width - 2));
		return this.theme.bg(SubagentsBrowser.PANEL_BG, this.theme.fg("border", `${l}${mid}${r}`));
	}

	private blankRow(width: number): string {
		return this.boxed("", width);
	}


	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			if (this.view === "detail") {
				this.view = "list";
				this.detailRunId = undefined;
				this.scroll = 0;
				this.scrollX = 0;
			} else {
				this.onClose();
				return;
			}
			this.invalidate();
			this.tui.requestRender();
			return;
		}
		if (this.view === "detail") {
			this.handleDetailInput(data);
		} else {
			this.handleListInput(data);
		}
	}

	private handleListInput(data: string): void {
		const runs = this.getRuns();
		if (runs.length === 0) return;
		if (matchesKey(data, Key.up) || data === "k") this.selected = Math.max(0, this.selected - 1);
		else if (matchesKey(data, Key.down) || data === "j") this.selected = Math.min(runs.length - 1, this.selected + 1);
		else if (matchesKey(data, Key.pageUp)) this.selected = Math.max(0, this.selected - BROWSER_PAGE);
		else if (matchesKey(data, Key.pageDown)) this.selected = Math.min(runs.length - 1, this.selected + BROWSER_PAGE);
		else if (matchesKey(data, Key.home)) this.selected = 0;
		else if (matchesKey(data, Key.end)) this.selected = runs.length - 1;
		else if (matchesKey(data, Key.enter) || matchesKey(data, Key.right) || data === "l") {
			const run = runs[this.selected];
			if (run) {
				this.detailRunId = run.runId;
				this.scroll = 0;
				this.scrollX = 0;
				this.view = "detail";
			}
		} else {
			return;
		}
		this.invalidate();
		this.tui.requestRender();
	}

	private handleDetailInput(data: string): void {
		if (matchesKey(data, Key.backspace)) {
			this.view = "list";
			this.detailRunId = undefined;
			this.scroll = 0;
			this.scrollX = 0;
			this.invalidate();
			this.tui.requestRender();
			return;
		}
		const hStep = Math.max(1, Math.floor((this.cachedWidth - 2) / 2));
		if (matchesKey(data, Key.left) || data === "h") this.scrollX = Math.max(0, this.scrollX - hStep);
		else if (matchesKey(data, Key.right) || data === "l") this.scrollX += hStep;
		else if (matchesKey(data, Key.up) || data === "k") this.scroll = Math.max(0, this.scroll - 1);
		else if (matchesKey(data, Key.down) || data === "j") this.scroll += 1;
		else if (matchesKey(data, Key.pageUp)) this.scroll = Math.max(0, this.scroll - BROWSER_PAGE);
		else if (matchesKey(data, Key.pageDown)) this.scroll += BROWSER_PAGE;
		else if (matchesKey(data, Key.home) || data === "g") this.scroll = 0;
		else if (matchesKey(data, Key.end) || data === "G") this.scroll = Number.MAX_SAFE_INTEGER;
		else return;
		this.invalidate();
		this.tui.requestRender();
	}

	render(width: number): string[] {
		if (this.cachedLines.length > 0 && this.cachedWidth === width) return this.cachedLines;
		const runs = this.getRuns();
		if (this.view === "detail" && this.detailRunId) {
			const run = runs.find((r) => r.runId === this.detailRunId);
			if (run) {
				this.cachedLines = this.renderDetail(run, width);
				this.cachedWidth = width;
				return this.cachedLines;
			}
			this.view = "list";
		}
		this.cachedLines = this.renderList(runs, width);
		this.cachedWidth = width;
		return this.cachedLines;
	}

	private renderList(runs: LiveRun[], width: number): string[] {
		const th = this.theme;
		const lines: string[] = [];
		const active = runs.filter((r) => r.status === "running").length;
		const totalCost = runs.reduce((s, r) => s + r.usage.cost, 0);
		const title = th.fg("accent", th.bold(" Subagents "));
		const summary = ` ${runs.length} runs · ${active} active · $${totalCost.toFixed(4)}`;
		const filler = th.fg("borderMuted", "─".repeat(Math.max(0, width - 2 - visibleWidth(title) - visibleWidth(summary))));
		lines.push(this.boxBorder(width, true));
		lines.push(this.boxed(`${title}${filler}${summary}`, width));
		lines.push(this.blankRow(width));

		if (runs.length === 0) {
			lines.push(
				this.boxed(`  ${th.fg("dim", "No subagent runs yet — delegate work with the subagent tool and check back here.")}`, width),
			);
		} else {
			const maxRows = BROWSER_MAX_ROWS;
			const start = Math.max(0, Math.min(this.selected - Math.floor(maxRows / 2), Math.max(0, runs.length - maxRows)));
			const end = Math.min(runs.length, start + maxRows);
			if (start > 0) lines.push(this.boxed(`  ${th.fg("dim", `… ${start} older runs`)}`, width));
			for (let i = start; i < end; i++) {
				const r = runs[i]!;
				const row = this.listRow(r);
				const indent = i === this.selected ? th.fg("accent", "▍") : " ";
				const line = `${indent}${row}`;
				lines.push(i === this.selected ? this.boxed(line, width, "selectedBg") : this.boxed(line, width));
				if (r.status === "error" && r.errorMessage) {
					lines.push(this.boxed(`  ${th.fg("error", preview(r.errorMessage, 100))}`, width));
				}
			}
			if (end < runs.length) lines.push(this.boxed(`  ${th.fg("dim", `… ${runs.length - end} newer runs`)}`, width));
			if (runs.length > maxRows) lines.push(this.boxed(`  ${th.fg("dim", `showing ${start + 1}–${end} of ${runs.length}`)}`, width));
		}
		lines.push(this.blankRow(width));
		lines.push(this.boxed(th.fg("dim", " ↑/↓ j/k navigate · enter inspect · esc close"), width));
		lines.push(this.boxBorder(width, false));
		return lines;
	}

	private listRow(r: LiveRun): string {
		const th = this.theme;
		const icon = statusIcon(r.status);
		const elapsed = r.status === "running" ? formatElapsed(Date.now() - r.startTime) : r.endTime ? formatElapsed(r.endTime - r.startTime) : "…";
		const status =
			r.status === "running" ? th.fg("accent", `running ${elapsed}`) : r.status === "ok" ? th.fg("success", `ok ${elapsed}`) : th.fg("error", `error ${elapsed}`);
		const parts = [icon, th.fg("accent", runDisplayName(r)), th.fg("dim", r.model), status];
		const u = usageLine(r.usage);
		if (u) parts.push(th.fg("dim", u));
		return parts.join(" · ");
	}

	private renderDetail(run: LiveRun, width: number): string[] {
		const th = this.theme;
		const lines: string[] = [];
		const icon = statusIcon(run.status);
		const elapsed = run.status === "running" ? formatElapsed(Date.now() - run.startTime) : run.endTime ? formatElapsed(run.endTime - run.startTime) : "…";
		const status =
			run.status === "running" ? th.fg("accent", `running ${elapsed}`) : run.status === "ok" ? th.fg("success", `ok ${elapsed}`) : th.fg("error", `error ${elapsed}`);
		lines.push(this.boxBorder(width, true));
		lines.push(this.boxed(`${icon} ${th.fg("accent", th.bold(runDisplayName(run)))} · ${th.fg("dim", run.model)} · ${status}`, width));
		const u = usageLine(run.usage);
		if (u) lines.push(this.boxed(th.fg("dim", u), width));
		if (run.errorMessage) lines.push(this.boxed(th.fg("error", run.errorMessage), width));
		if (run.sessionId) lines.push(this.boxed(th.fg("dim", `session: ${run.sessionId}`), width));
		lines.push(this.boxed(th.fg("muted", `Task: ${run.task}`), width));
		lines.push(this.blankRow(width));

		let body: BodyLine[];
		if (run.messages && run.messages.length > 0) {
			body = transcriptBodyLines(run.messages, th, width, BROWSER_DETAIL_CAP);
		} else if (run.activities && run.activities.length > 0) {
			body = run.activities.map((a) => ({
				text: `${th.fg("dim", `+${formatElapsed(a.at)}`)} ${activityLine(a, th)}`,
				code: false,
			}));
		} else {
			body = [{ text: th.fg("dim", "No activity recorded for this run."), code: false }];
		}

		const innerWidth = Math.max(1, width - 2);
		const maxCodeWidth = body.reduce((m, l) => (l.code ? Math.max(m, visibleWidth(l.text)) : m), 0);
		const hasOverflow = maxCodeWidth > innerWidth;
		if (hasOverflow) this.scrollX = Math.min(this.scrollX, maxCodeWidth - innerWidth);
		else this.scrollX = 0;

		const maxScroll = Math.max(0, body.length - BROWSER_DETAIL_ROWS);
		if (this.scroll > maxScroll) this.scroll = maxScroll;
		const start = this.scroll;
		const end = Math.min(body.length, start + BROWSER_DETAIL_ROWS);
		for (let i = start; i < end; i++) {
			const row = body[i]!;
			const text = row.code && hasOverflow ? sliceByColumn(row.text, this.scrollX, innerWidth) : row.text;
			lines.push(this.boxed(text, width));
		}

		lines.push(this.blankRow(width));
		const hints = [`↑/↓ scroll`];
		if (body.length > BROWSER_DETAIL_ROWS) {
			const pct = Math.min(100, Math.round((end / body.length) * 100));
			hints.unshift(` ${pct}% (${body.length} lines)`);
		}
		if (hasOverflow) hints.push(`←/→ h/l horiz${this.scrollX > 0 ? ` · col ${this.scrollX}` : ""}`);
		hints.push("backspace back · esc close");
		lines.push(this.boxed(th.fg("dim", ` ${hints.join(" · ")}`), width));
		lines.push(this.boxBorder(width, false));
		return lines;
	}
}
