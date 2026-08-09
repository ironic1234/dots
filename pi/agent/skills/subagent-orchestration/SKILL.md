---
name: subagent-orchestration
description: Plan and coordinate reliable subagent workflows with parallel, chain, continuation, and failure controls.
---

# Subagent orchestration

Use this skill when a task benefits from delegated research, implementation, or review. The orchestrator owns decomposition, sequencing, recovery, and synthesis; subagents own focused work.

## Default workflow

1. **Decompose** the request into narrow tasks with an explicit expected output.
2. **Scout or plan first** when the repository or requirements are unfamiliar.
3. **Fan out independent work** with `tasks` and `parallelLimit: 2-4`. Keep parallel tasks read-only or ensure their mutation targets do not overlap.
4. **Chain dependent work** with `chain` and `{previous}`. A reliable implementation flow is scout/planner → focused worker → reviewer.
5. **Synthesize and verify** the results in the orchestrator. A worker's partial or failed result is evidence, not completion.

## Controls

- `agent`: use a named role when its tools and instructions fit the task.
- `model`: choose a cheap model for routine scouting and a stronger model for planning, implementation, or review.
- `tools`: restrict the worker to the smallest useful allowlist; use read-only tools for scouts/planners/reviewers.
- `cwd`: set the repository or project directory explicitly when it differs from the parent.
- `thinking`: use `off`/`low` for routine workers and higher reasoning for difficult planning or review.
- `maxTurns`: choose a real budget for the work. Rough defaults: scout 18, planner 18, reviewer 22, worker 40. Do not use a tiny budget merely to prevent loops.
- `timeoutSec`: set a wall-clock limit appropriate to the task.
- `parallelLimit`: control concurrency for independent tasks; leave it at 1 for dependent or resource-sensitive work.
- `onFailure: "stop"` (default): stop a dependent chain when a step fails. Use `onFailure: "continue"` only when later steps can recover from partial evidence.
- `keepSession: true`: request a continuation handle for work likely to need follow-up.
- `sessionId`: resume the exact in-process context from a prior result. Give resumed workers a narrower continuation task instead of repeating the original request.

## Turn-budget recovery

The runner reserves one finalization turn at the max-turn boundary and asks the worker to stop using tools and summarize verified versus unverified findings. If it still fails:

1. Inspect the returned partial output and failure reason.
2. If a session handle is present, continue it with `sessionId` and a focused task such as “finish the implementation and run the remaining validation; do not re-explore unrelated files.”
3. Otherwise, split the unfinished work into a smaller task or retry it with a larger `maxTurns` and a tighter system prompt.
4. Never silently treat a max-turn result as success.

## Task contracts

Every task should state:

- the exact question or change;
- files or scope to inspect;
- tools and mutation permissions;
- the expected final format;
- the validation command or evidence required.

Ask workers to batch independent reads, avoid repeated context inspection, and stop exploring once they have enough evidence to produce the requested output.
