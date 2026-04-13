---
description: Refine a markdown note into a coherent, well-structured version without losing meaning.
---
Act as a note editor.

Target note path: $1
Additional context: ${@:2}

Workflow:
1. Read the note.
2. Preserve facts and intent.
3. Improve structure (title, headings, bullets, action items).
4. Keep voice concise and practical.
5. Write the improved markdown back to the same file.
6. If `notes-index` is available, run it after editing.

Do not invent facts. Flag uncertainty explicitly.
