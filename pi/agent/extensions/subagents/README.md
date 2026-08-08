# Subagents extension

Robust subagent orchestration for pi: an orchestrator (the main agent) can spin
up, monitor, and prompt subagents of **arbitrary models**, each with **its own
isolated context window** — all **in-process** (no extra `pi` processes are
spawned).

## Why in-process?

Each subagent is a separate `Agent` instance from `@earendil-works/pi-agent-core`
with its own transcript. The parent session keeps running as usual. Because no
child processes are spawned:

- Subagents cost almost no extra CPU/memory overhead.
- There are no orphaned processes to clean up on abort or crash.
- `parallelLimit > 1` just interleaves in-process agents on the event loop;
  the default is still sequential (`parallelLimit: 1`) to keep behavior
  predictable.

## Usage

The `subagent` tool is available to the main agent with three modes:

| Field        | Type   | Description |
|--------------|--------|-------------|
| `task`       | string | Task text (single mode) |
| `tasks`      | array  | Independent tasks, run sequentially by default (parallel mode; `parallelLimit` opt-in) |
| `chain`      | array  | Ordered tasks; `{previous}` in a task text is replaced with the previous result (chain mode) |
| `model`      | string | Arbitrary model: `"provider/id"`, `"provider/*"`, or bare id — validated against the model registry before running |
| `agent`      | string | Agent definition name (from agent files) |
| `systemPrompt`| string| Inline system prompt (overrides agent prompt) |
| `tools`      | array  | Tool allowlist (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) |
| `thinking`   | string | Reasoning level for the subagent model: `off` (default — cheap & fast), `minimal`, `low`, `medium`, `high`, `xhigh`, `max` (model-dependent). Raise it for harder tasks that benefit from reasoning; the level is passed straight through to the provider. |
| `timeoutSec` | number | Abort the subagent after N seconds |
| `maxTurns`   | number | Abort after N assistant turns |
| `cwd`        | string | Working directory for the subagent |
| `keepSession`| bool   | Return a `sessionId` to continue this context window later |
| `sessionId`  | string | Continue an existing context window (from a prior `keepSession`) |

### Multi-turn sessions

Subagents are stateless by default. To make one remember across calls:

1. Call with `keepSession: true`; the result includes a line like
   `[Session: <uuid> — pass as sessionId to continue this context window]`.
2. Later, call again with that `sessionId` — the same in-process agent
   continues its transcript, so it remembers everything from the earlier run.

### Watchdogs

- `timeoutSec`: aborts the subagent after N seconds (honored even mid-stream).
- `maxTurns`: counts assistant messages and aborts runaway tool loops.
- Parent abort (Ctrl+C / goal-mode interrupt) propagates to running subagents.

## Agent files

- User agents: `<agentDir>/agents/*.md`
- Project agents (opt-in, trusted repos only): `.pi/agents/*.md`

Frontmatter keys: `name`, `description`, `model`, `tools`, `thinking`,
`timeoutSec`, `maxTurns`. See the bundled samples (`scout`, `planner`,
`worker`, `reviewer`) in `agent/agents/`.

## Orchestrator pattern (strong planner + cheap workers)

Run the main pi session on your strongest model and delegate heavy or parallelizable
work to cheap worker models via `subagent`:

- Every session's system prompt includes a **Subagent extension** block with an
  **Orchestrator pattern** section and a live **cheapest configured worker models**
  catalog (sorted by price, from the model registry, top 6) so the planner can
  pick workers without knowing model ids by heart.
- Set `model: "provider/id"` per task — each subagent runs any registered model;
  `thinking: "off"` for cheap/fast workers.
- Workers without an explicit `systemPrompt` get a default that asks for a
  **concise final answer (1-3 sentences)**, so results stay small in the planner's
  context.
- `parallel` for independent fan-out, `chain` for dependent steps (`{previous}`),
  `keepSession`/`sessionId` for workers that need shared memory.
- `/subagents` opens a live browser showing per-run cost, activity, and
  transcripts so you can watch worker spend.

## Monitoring & inspection

### Live visibility while runs happen

- Every run is persisted with `pi.appendEntry("subagent-run", …)` plus a
  `"subagent-run-detail"` entry carrying the full per-run transcript
  (truncated) for later inspection.
- While a `subagent` tool call is executing, the tool result is **streamed**:
  a throttled live dashboard (running status, thinking previews, tool calls and
  their results, usage) is pushed via `onUpdate`, so the TUI shows subagents
  working in real time instead of a frozen spinner.
- `index.ts` keeps an in-memory registry of live runs merged with persisted
  entries, so the browser works during and after runs (even across extension
  reloads within the session).

### `/subagents` browser

In the TUI, `/subagents` opens a full-screen overlay (Esc to close) drawn as a
real box: `╭─╮`/`╰─╯` corners and `│` side rails in the theme border color, on
a darker-than-session panel fill (mantle), so it stays clearly separated from
the session output behind it. The selected run row is highlighted with
`selectedBg`:

- **List view** — every run in the session (live first, then newest first),
  with status (running/ok/error), model, elapsed time, and usage. Navigate
  with `↑/↓` (`j`/`k`), page with `PgUp/PgDn`; `Enter` (or `l`) opens a run.
- **Detail view** — per-run transcript: streamed thinking, tool calls with
  their arguments, tool results (with errors highlighted), the final output,
  and usage. Prose (thinking/text) wraps to the panel width; code rows (tool
  arguments, tool output) keep full width and scroll horizontally with
  `←/→` (`h`/`l`) — the footer shows the column offset. Scroll vertically
  with `↑/↓`; `g`/`G` jump to top/bottom; `Backspace` returns to the list;
  Esc closes. Live runs refresh automatically.
- An optional filter argument (`/subagents <agent-or-model>` ) narrows the
  list.
- In non-TUI modes (print/RPC), `/subagents` falls back to a plain-text
  widget listing the most recent runs.

When the tool finishes, `renderResult` renders the final per-run results
(expanded view shows the full transcript inline; collapsed shows the final
output with a `Ctrl+O` hint).

## Development

- `runner.ts` — `runSubagent()`: resolves model/provider/auth, builds the
  in-process agent with a minimal mock extension context for the built-in
  tools, watchdogs, session cache, usage accumulation, and a throttled live
  event stream (`RunnerEvent`: `message`, `tool`, `toolResult`, `thinking`,
  `status`) consumed by `index.ts` for the dashboard/browser.
- `ui.ts` — TUI building blocks: `renderLiveDashboard` (streamed while
  running), `renderRunResults` (final view), and the interactive
  `SubagentsBrowser` overlay used by `/subagents`.
- `agents.ts` — agent discovery + frontmatter parsing.
- `index.ts` — tool registration, live-run registry, `/subagents` command,
  TUI renderers.
- Deterministic tests (stub provider, no network): `bun test
  /tmp/subagent-tests/runner-inproc.test.ts` (compile `runner.ts` into
  `/tmp/subagent-tests/dist` first via `tsconfig.subagents.emit.json`, since
  Bun resolves bare specifiers from the test file's directory).
