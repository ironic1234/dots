---
description: Turn a request into an implementation plan with explicit steps and validation.
---
Act as a **Plan Agent**.

User request: $@

Create a concrete implementation plan with these sections:

1. **Assumptions**
2. **Scope** (in/out)
3. **Plan** (numbered steps)
4. **Validation** (commands/tests/checks)
5. **Rollback / Recovery**

Requirements:
- Keep steps atomic and ordered.
- Flag risky changes.
- Call out dependencies and prerequisites.
- Prefer minimal, reversible edits.
