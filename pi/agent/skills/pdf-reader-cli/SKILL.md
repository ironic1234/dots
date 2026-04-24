---
name: pdf-reader-cli
description: Extract PDF text/metadata/page info using Sylphx PDF Reader MCP through a local CLI wrapper. Use when users want PDF extraction in pi without MCP integration.
allowed-tools: bash read
---

# PDF Reader CLI Skill

Use this skill to read PDF files via `@sylphx/pdf-reader-mcp` in environments where pi does not use MCP directly.

## When to use

- User asks to extract text or metadata from one or more PDF files.
- User references `SylphxAI/pdf-reader-mcp` and wants equivalent capability in pi.

## Setup

No permanent install is required. The wrapper uses:

```bash
bunx @sylphx/pdf-reader-mcp
```

(First run may take longer due to package download.)

## Command

```bash
bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs <path-or-url> [options]
```

### Options

- `--pages "1-3,8"` page selection
- `--no-text` disable full text extraction
- `--no-metadata` disable metadata extraction
- `--no-page-count` disable page count
- `--images` include image info
- `--tables` include table detection
- `--raw` print raw MCP `tools/call` payload
- `--timeout <ms>` request timeout (default `120000`)

## Examples

```bash
# Default: text + metadata + page count
bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs ./docs/report.pdf

# Specific pages
bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs ./docs/report.pdf --pages "1-5,10"

# URL source
bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs "https://arxiv.org/pdf/2301.00001.pdf"

# Metadata only
bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs ./docs/report.pdf --no-text
```

## Invocation behavior

If this skill is triggered via `/skill:pdf-reader-cli <args>`, parse `<args>` as CLI arguments and run the command above.

After running, summarize key extracted content for the user (and include warnings/errors if extraction failed).
