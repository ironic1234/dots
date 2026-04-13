---
name: life-capture
description: Converts natural language into Taskwarrior and Timewarrior operations (add/update tasks, start/stop tracking, quick note capture). Use for daily personal productivity logging.
---

# Life Capture

Use this skill when the user gives informal status updates like:
- "worked on compiler notes for 45 minutes"
- "start tracking interview prep"
- "remind me to submit FAFSA tomorrow"

## Data locations

Prefer these explicit data paths to keep tracking data in the synced life workspace:

```bash
task rc.data.location=~/.local/share/life/task ...
timew rc.data.location=~/.local/share/life/timewarrior ...
```

## Operating procedure

1. Parse the user request into intent(s):
   - add task
   - complete/modify task
   - start/stop/switch active timer
   - append note to `~/notes/inbox.md`
2. Show the exact command(s) before execution.
3. Ask for confirmation when commands are destructive or ambiguous.
4. Execute confirmed commands.
5. Summarize resulting active task/time state.

## Command patterns

- Add task:
  ```bash
  task rc.data.location=~/.local/share/life/task add <description> +tag project:<project>
  ```
- Start tracking:
  ```bash
  timew rc.data.location=~/.local/share/life/timewarrior start <tag1> <tag2>
  ```
- Stop tracking:
  ```bash
  timew rc.data.location=~/.local/share/life/timewarrior stop
  ```
- Complete task:
  ```bash
  task rc.data.location=~/.local/share/life/task <id> done
  ```

After a successful session, suggest `life-sync sync`.
