---
name: pdf-reader-cli
description: Extract PDF text, metadata, and page info using Sylphx PDF Reader MCP with automatic MuPDF (mutool) fallback for large documents such as chip reference manuals. Use when users want PDF extraction in pi without MCP integration.
allowed-tools: bash read
---

# PDF Reader CLI Skill

Use this skill to read PDF files via `@sylphx/pdf-reader-mcp`, with automatic fallback to the local MuPDF CLI (`mutool`) for very large documents whose text exceeds the MCP server's output budget.

## When to use

- User asks to extract text or metadata from one or more PDF files.
- User references `SylphxAI/pdf-reader-mcp` and wants equivalent capability in pi.
- Large datasheets / reference manuals (e.g. `STM32G4_RM0440.pdf`, ~39 MB / 2140 pages) that the MCP server cannot fully extract.

## Setup

No permanent install is required. The MCP wrapper uses:

```bash
bunx @sylphx/pdf-reader-mcp
```

The fallback uses the local MuPDF CLI:

```bash
mutool   # /opt/homebrew/bin/mutool
```

(First MCP run downloads the package + native binary and can take a couple of minutes; afterwards startup is fast. mutool is always instant.)

## Engines

`--engine auto` (default) picks:

- **mcp** — Sylphx MCP server: rich evidence output (text, tables, images, markdown, chunks, annotations, page-level locators) and handles `https://` URLs. Has a hard server-side text-size budget, so text extraction fails on huge manuals.
- **mutool** — local MuPDF: instant, no size limit, ideal for big manuals; plain text + metadata + page count + PNG page rendering only (no tables/evidence). Cannot fetch URLs in this build.

`auto` routes **files > 15 MB to mutool** and, if MCP reports a text-budget error on local files, automatically retries with mutool. Force either side with `--engine mcp` / `--engine mutool`.

## Command

```bash
bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs <path-or-url> [<path-or-url>...] [options]
```

### Options

- `--engine <auto|mcp|mutool>` extraction backend (default `auto`)
- `--pages "1-3,8"` page selection
- `--text` / `--no-text` full text extraction (default: on)
- `--metadata` / `--no-metadata` (default: on)
- `--page-count` / `--no-page-count` (default: on)
- `--render-dir <dir>` render selected pages as PNG files (mutool engine)
- `--images` include image info (MCP only)
- `--tables` include table detection (MCP only)
- `--markdown` include markdown output (MCP only)
- `--chunks` include text chunks (MCP only)
- `--annotations` include annotations (MCP only)
- `--outline` include document outline (MCP only)
- `--page-labels` include page labels (MCP only)
- `--ocr-text` include OCR text layer (MCP only)
- `--sample-pages <n>` limit pages analyzed (MCP only)
- `--auto` enable MCP auto extraction mode (MCP only)
- `--raw` print raw MCP `tools/call` response
- `--timeout <ms>` request timeout (default `600000`)

## Examples

```bash
# Default: text + metadata + page count
bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs ./docs/report.pdf

# Large reference manual (auto -> mutool, full 2140-page text in ~2 s)
bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs ~/coding/PER/Projects/firmware/docs/datasheets/STM32G4_RM0440.pdf

# Metadata + page count only
bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs ~/coding/PER/Projects/firmware/docs/datasheets/STM32G4_RM0440.pdf --no-text

# Specific pages (e.g. a GPIO chapter)
bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs ~/coding/PER/Projects/firmware/docs/datasheets/STM32G4_RM0440.pdf --pages "400-450"

# Render pages 1-3 as PNGs
bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs ~/coding/PER/Projects/firmware/docs/datasheets/STM32G4_RM0440.pdf --no-text --render-dir /tmp/rm0440-pages --pages "1-3"

# URL source (must use MCP engine; mutool cannot fetch URLs)
bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs "https://arxiv.org/pdf/2301.00001.pdf"

# Multiple files
bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs ./a.pdf ./b.pdf --no-page-count
```

## Known limitation

For huge documents (e.g. `STM32G4_RM0440.pdf`), the MCP server fails text extraction with `selectable text exceeds bounded raw-part budget` — a hard-coded server limit (latest version 4.1.2). The skill auto-switches to `mutool`, which extracts the full 2140-page manual in ~2 s. Prefer `mutool` for these files; use `--pages` to pull specific sections.

## Invocation behavior

If this skill is triggered via `/skill:pdf-reader-cli <args>`, parse `<args>` as CLI arguments and run the command above.

After running, summarize key extracted content for the user (and include warnings/errors if extraction failed).
