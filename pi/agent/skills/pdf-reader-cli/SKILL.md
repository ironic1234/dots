---
name: pdf-reader-cli
description: Read PDFs in Pi using local MuPDF (mutool) for fast plain extraction, or Sylphx PDF Reader MCP for URLs and structured PDF evidence.
allowed-tools: bash read
---

# PDF Reader CLI Skill

Use this skill when the user asks you to read, inspect, extract, or render a PDF. The CLI has two backends:

- **MuPDF (`mutool`)** for fast, local, plain-text work.
- **Sylphx PDF Reader MCP** for remote PDFs and structured/evidence-oriented work.

The wrapper is a CLI around both engines; it does not require Pi itself to have MCP configured.

## Choose the engine deliberately

Use an explicit `--engine` whenever the requested output matters. Do not choose an engine solely because one is available.

| User need                                                           | Engine   | Guidance                                                             |
| ------------------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| Local PDF text, metadata, page count                                | `mutool` | Preferred default, especially for large manuals.                     |
| Render selected local pages to PNG                                  | `mutool` | Use `--render-dir` and `--no-text` when only images are needed.      |
| `https://` PDF                                                      | `mcp`    | The installed MuPDF build cannot fetch URLs.                         |
| Tables or table structure                                           | `mcp`    | Use `--tables`; MuPDF output is plain text only.                     |
| Markdown, chunks, page-level locators, bounding boxes, or citations | `mcp`    | Use `--markdown` and/or `--chunks` as appropriate.                   |
| Images, annotations, outline, page labels                           | `mcp`    | These are MCP-only options in this wrapper.                          |
| OCR text layer                                                      | `mcp`    | Use `--ocr-text`; report a warning if no OCR provider is configured. |

### What `--engine auto` actually does

`auto` is a convenience fallback, not a capability-aware planner:

- local files larger than 15 MiB → `mutool`;
- all other sources → MCP;
- an MCP text-budget error on local files → retry with `mutool`.

It does **not** inspect rich flags before choosing. A large file requested with `--tables`, for example, will use MuPDF and report that the table option was ignored. Prefer explicit engines for those requests. Also avoid mixing URLs and large local files in one `auto` invocation; run separate commands when sources need different engines.

`--engine auto` and `--auto` are different: `--auto` enables the MCP server's extraction mode. It is passed through when `auto` selects MCP, and is ignored when `auto` selects MuPDF.

## Recommended agent workflow

1. **Classify the request.** Identify whether the source is local or remote and whether the user needs plain text or structured evidence.
2. **Start small for large documents.** First get metadata/page count without text, then extract only the relevant page range:
    ```bash
    bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs <file.pdf> --engine mutool --no-text
    bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs <file.pdf> --engine mutool --pages "400-450"
    ```
3. **Do not dump an entire large manual into Pi's context.** MuPDF avoids the MCP server's text-size limit, but a full manual can still exceed Pi's tool-output/context budget. Use `--pages` and make multiple targeted calls.
4. **Use MCP for evidence requests and constrain it to pages whenever possible:**
    ```bash
    bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs <file.pdf> --engine mcp --pages "14-16" --tables --markdown --chunks
    ```
5. **For scanned/image-only PDFs**, try MCP OCR if configured. Otherwise render the relevant pages with MuPDF and inspect the PNGs:
    ```bash
    bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs <file.pdf> --engine mutool --no-text --render-dir /tmp/pdf-pages --pages "1-3"
    ```
6. **Group sources by engine.** Run local MuPDF inputs separately from URL/rich MCP inputs instead of relying on one mixed invocation.
7. **Report the engine, page range, key extracted content, and any warnings/errors.** Do not claim that a table, OCR result, or citation exists when the selected engine did not provide it.

## Setup

### MuPDF

`mutool` is a local dependency. Verify it before using the MuPDF engine:

```bash
command -v mutool
mutool -v
```

On macOS with Homebrew, install it with:

```bash
brew install mupdf-tools
```

The command must be on `PATH`; do not assume a hard-coded Homebrew path on other machines.

### MCP

The MCP backend starts:

```bash
bunx @sylphx/pdf-reader-mcp
```

No permanent install is required, but the first run may download the package and native binary, so it needs network access. Prefer MuPDF when the task is local plain extraction and use MCP when its structured capabilities are needed.

## Command

```bash
bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs <path-or-url> [<path-or-url>...] [options]
```

## Options

- `--engine <auto|mcp|mutool>` backend selection (default: `auto`; see the caveat above)
- `--pages "1-3,8"` restrict extraction/rendering to physical page ranges
- `--text` / `--no-text` full text (default: on)
- `--metadata` / `--no-metadata` metadata (default: on)
- `--page-count` / `--no-page-count` page count (default: on)
- `--render-dir <dir>` render selected pages as PNGs (MuPDF only)
- `--images` image info (MCP only)
- `--tables` table extraction (MCP only)
- `--markdown` markdown output (MCP only)
- `--chunks` text chunks with locators (MCP only)
- `--annotations` annotations (MCP only)
- `--outline` document outline (MCP only)
- `--page-labels` page labels (MCP only)
- `--ocr-text` OCR text layer (MCP only)
- `--sample-pages <n>` limit MCP page analysis
- `--auto` enable MCP auto extraction mode
- `--raw` print the raw MCP response
- `--timeout <ms>` request timeout (default: 600000)

MuPDF returns plain text, parsed metadata, page count, and optionally rendered PNG paths. MCP returns structured results and can include tables, markdown, chunks, and evidence metadata. MCP-only flags passed to MuPDF are ignored with a note, so select the MCP engine explicitly when those results are required.

## Examples

```bash
# Local PDF: fast plain extraction
bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs ./docs/report.pdf --engine mutool

# Large manual: metadata first, then a targeted chapter
bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs ./docs/manual.pdf --engine mutool --no-text
bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs ./docs/manual.pdf --engine mutool --pages "400-450"

# Render local pages for visual inspection
bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs ./docs/manual.pdf --engine mutool --no-text --render-dir /tmp/manual-pages --pages "1-3"

# Structured table/evidence extraction from a local report
bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs ./docs/report.pdf --engine mcp --pages "10-12" --tables --markdown --chunks

# Remote PDF
bun ~/.pi/agent/skills/pdf-reader-cli/scripts/read-pdf.mjs "https://arxiv.org/pdf/2301.00001.pdf" --engine mcp --pages "1-5"
```

## Failure handling and response

- If `mutool` is missing, either use MCP for a small/local file or explain that MuPDF must be installed; do not silently pretend the extraction succeeded.
- If MCP cannot start or download, use MuPDF only for a local file when the user needs plain extraction; otherwise report the dependency/network failure.
- If output is truncated or a large-document extraction is too broad, rerun with `--pages` rather than repeating the same full-text command.
- After running, summarize the relevant content and include the selected pages, engine, and warnings/errors. Keep raw JSON out of the final response unless the user requests it.

If this skill is invoked via `/skill:pdf-reader-cli <args>`, parse `<args>` as CLI arguments and run the command above.
