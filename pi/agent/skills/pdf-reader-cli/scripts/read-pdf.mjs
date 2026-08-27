#!/usr/bin/env bun

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 600_000;
const LARGE_FILE_BYTES = 15 * 1024 * 1024;

function printUsage() {
	console.log(`Usage:
  read-pdf.mjs <path-or-url> [<path-or-url>...] [options]

Extract text, metadata, and page info from PDFs.

Engines:
  --engine <auto|mcp|mutool>   Extraction backend (default: auto)
      auto    -> MCP for normal PDFs; MuPDF (mutool) for large files (>15 MB),
                 and automatic retry with mutool when MCP hits its text budget
      mcp     -> Sylphx PDF Reader MCP (@sylphx/pdf-reader-mcp)
      mutool  -> local MuPDF CLI (instant, no size limit; no tables/evidence)

Options:
  --pages <spec>         Page selection (e.g. "1-5,8")
  --text                 Include full text (default: true)
  --no-text              Disable full text
  --metadata             Include metadata (default: true)
  --no-metadata          Disable metadata
  --page-count           Include page count (default: true)
  --no-page-count        Disable page count
  --render-dir <dir>     Render selected pages as PNG files (mutool engine)
  --images               Include image info (MCP engine only)
  --tables               Include table extraction (MCP engine only)
  --markdown             Include markdown output (MCP engine only)
  --chunks               Include text chunks (MCP engine only)
  --annotations          Include annotations (MCP engine only)
  --outline              Include document outline (MCP engine only)
  --page-labels          Include page labels (MCP engine only)
  --ocr-text             Include OCR text layer (MCP engine only)
  --sample-pages <n>     Limit pages analyzed (MCP engine only)
  --auto                 Enable MCP auto extraction mode (MCP engine only)
  --raw                  Print raw MCP tools/call response
  --timeout <ms>         Timeout per request (default: 600000)
  -h, --help             Show this help
`);
}

function parseArgs(argv) {
	if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
		return { help: true };
	}

	const sources = [];
	const options = {
		include_full_text: true,
		include_metadata: true,
		include_page_count: true,
		include_images: false,
		include_tables: false,
		include_markdown: false,
		include_chunks: false,
		include_annotations: false,
		include_outline: false,
		include_page_labels: false,
		include_ocr_text_layer: false,
		sample_pages: undefined,
		auto: false,
		engine: "auto",
		pages: undefined,
		renderDir: undefined,
		raw: false,
		timeoutMs: DEFAULT_TIMEOUT_MS,
	};

	let i = 0;
	while (i < argv.length) {
		const arg = argv[i];

		if (arg === "--pages") {
			const value = argv[++i];
			if (!value) throw new Error("--pages requires a value");
			options.pages = value;
			i++;
			continue;
		}

		if (arg === "--text") {
			options.include_full_text = true;
			i++;
			continue;
		}
		if (arg === "--no-text") {
			options.include_full_text = false;
			i++;
			continue;
		}

		if (arg === "--metadata") {
			options.include_metadata = true;
			i++;
			continue;
		}
		if (arg === "--no-metadata") {
			options.include_metadata = false;
			i++;
			continue;
		}

		if (arg === "--page-count") {
			options.include_page_count = true;
			i++;
			continue;
		}
		if (arg === "--no-page-count") {
			options.include_page_count = false;
			i++;
			continue;
		}

		if (arg === "--images") {
			options.include_images = true;
			i++;
			continue;
		}

		if (arg === "--tables") {
			options.include_tables = true;
			i++;
			continue;
		}

		if (arg === "--markdown") {
			options.include_markdown = true;
			i++;
			continue;
		}

		if (arg === "--chunks") {
			options.include_chunks = true;
			i++;
			continue;
		}

		if (arg === "--annotations") {
			options.include_annotations = true;
			i++;
			continue;
		}

		if (arg === "--outline") {
			options.include_outline = true;
			i++;
			continue;
		}

		if (arg === "--page-labels") {
			options.include_page_labels = true;
			i++;
			continue;
		}

		if (arg === "--ocr-text") {
			options.include_ocr_text_layer = true;
			i++;
			continue;
		}

		if (arg === "--sample-pages") {
			const value = argv[++i];
			if (!value) throw new Error("--sample-pages requires a value");
			const n = Number.parseInt(value, 10);
			if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --sample-pages value: ${value}`);
			options.sample_pages = n;
			i++;
			continue;
		}

		if (arg === "--auto") {
			options.auto = true;
			i++;
			continue;
		}

		if (arg === "--engine") {
			const value = argv[++i];
			if (!value) throw new Error("--engine requires a value");
			if (!["auto", "mcp", "mutool"].includes(value)) {
				throw new Error(`--engine must be one of: auto, mcp, mutool (got "${value}")`);
			}
			options.engine = value;
			i++;
			continue;
		}

		if (arg === "--render-dir") {
			const value = argv[++i];
			if (!value) throw new Error("--render-dir requires a value");
			options.renderDir = value;
			i++;
			continue;
		}

		if (arg === "--raw") {
			options.raw = true;
			i++;
			continue;
		}

		if (arg === "--timeout") {
			const value = argv[++i];
			if (!value) throw new Error("--timeout requires a value in milliseconds");
			const ms = Number.parseInt(value, 10);
			if (!Number.isFinite(ms) || ms <= 0) throw new Error(`Invalid --timeout value: ${value}`);
			options.timeoutMs = ms;
			i++;
			continue;
		}

		if (arg.startsWith("-")) {
			throw new Error(`Unknown argument: ${arg}`);
		}

		sources.push(arg);
		i++;
	}

	if (sources.length === 0) throw new Error("No PDF path or URL provided");

	return { sources, options };
}

function isUrl(input) {
	return /^https?:\/\//i.test(input);
}

function resolveSource(input) {
	if (isUrl(input)) return { kind: "url", value: input };
	return {
		kind: "path",
		value: path.isAbsolute(input) ? input : path.resolve(process.cwd(), input),
	};
}

function withTimeout(promise, ms, label) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`${label} timed out after ${ms}ms`));
		}, ms);

		if (typeof timer.unref === "function") {
			timer.unref();
		}

		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

function createRpcClient(proc, timeoutMs) {
	let buffer = "";
	let nextId = 1;
	const pending = new Map();

	proc.stdout.setEncoding("utf8");
	proc.stdout.on("data", (chunk) => {
		buffer += chunk;

		while (true) {
			const nl = buffer.indexOf("\n");
			if (nl === -1) break;

			const line = buffer.slice(0, nl).trim();
			buffer = buffer.slice(nl + 1);
			if (!line) continue;

			let message;
			try {
				message = JSON.parse(line);
			} catch {
				continue;
			}

			if (message.id === undefined) continue;
			const waiter = pending.get(message.id);
			if (!waiter) continue;

			pending.delete(message.id);
			waiter.resolve(message);
		}
	});

	proc.stderr.setEncoding("utf8");
	proc.stderr.on("data", (chunk) => {
		process.stderr.write(chunk);
	});

	proc.on("exit", (code, signal) => {
		const error = new Error(`PDF reader MCP process exited early (code=${code}, signal=${signal})`);
		for (const [, waiter] of pending) {
			waiter.reject(error);
		}
		pending.clear();
	});

	const send = (payload) => {
		proc.stdin.write(`${JSON.stringify(payload)}\n`);
	};

	const request = async (method, params) => {
		const id = nextId++;
		const responsePromise = new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
		});

		try {
			send({ jsonrpc: "2.0", id, method, params });
		} catch (error) {
			pending.delete(id);
			throw error;
		}

		const response = await withTimeout(responsePromise, timeoutMs, `${method} response`);

		if (response.error) {
			const message = response.error.message || JSON.stringify(response.error);
			throw new Error(`${method} failed: ${message}`);
		}

		return response.result;
	};

	const notify = (method, params) => {
		send({ jsonrpc: "2.0", method, params });
	};

	const close = () => {
		proc.kill("SIGTERM");
		setTimeout(() => {
			if (!proc.killed) proc.kill("SIGKILL");
		}, 500).unref();
	};

	return { request, notify, close };
}

function pickStructuredOutput(toolResult) {
	if (toolResult && typeof toolResult.structuredContent === "object" && toolResult.structuredContent !== null) {
		return toolResult.structuredContent;
	}

	const content = Array.isArray(toolResult?.content) ? toolResult.content : [];
	const firstJsonText = content.find(
		(item) => item?.type === "text" && typeof item.text === "string" && item.text.trim().startsWith("{"),
	);

	if (!firstJsonText) return toolResult;

	try {
		return JSON.parse(firstJsonText.text);
	} catch {
		return toolResult;
	}
}

async function runMcp(sources, options) {
	const mcpSources = sources.map((source) => {
		const src = source.kind === "url" ? { url: source.value } : { path: source.value };
		if (options.pages) src.pages = options.pages;
		return src;
	});

	const toolArguments = {
		sources: mcpSources,
		include_full_text: options.include_full_text,
		include_metadata: options.include_metadata,
		include_page_count: options.include_page_count,
		include_images: options.include_images,
		include_tables: options.include_tables,
		include_markdown: options.include_markdown,
		include_chunks: options.include_chunks,
		include_annotations: options.include_annotations,
		include_outline: options.include_outline,
		include_page_labels: options.include_page_labels,
		include_ocr_text_layer: options.include_ocr_text_layer,
	};
	if (options.sample_pages !== undefined) toolArguments.sample_pages = options.sample_pages;
	if (options.auto) toolArguments.auto = true;

	const proc = spawn("bunx", ["@sylphx/pdf-reader-mcp"], {
		stdio: ["pipe", "pipe", "pipe"],
		env: {
			...process.env,
			MCP_TRANSPORT: "stdio",
		},
	});

	const client = createRpcClient(proc, options.timeoutMs);

	try {
		await client.request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "pi-pdf-reader-cli", version: "1.0.0" },
		});

		client.notify("notifications/initialized");

		const toolResult = await client.request("tools/call", {
			name: "read_pdf",
			arguments: toolArguments,
		});

		const output = options.raw ? toolResult : pickStructuredOutput(toolResult);
		console.log(JSON.stringify(output, null, 2));

		const results = output && Array.isArray(output.results) ? output.results : [];
		if (toolResult?.isError || results.some((result) => result.success === false)) {
			process.exitCode = 1;
		}
	} finally {
		client.close();
	}
}

// --- mutool (MuPDF) engine -------------------------------------------------

function runWithTimeout(cmd, args, timeoutMs, label) {
	return new Promise((resolve, reject) => {
		execFile(
			cmd,
			args,
			{ timeout: timeoutMs, maxBuffer: 512 * 1024 * 1024, encoding: "utf8" },
			(error, stdout, stderr) => {
				if (error) {
					if (error.killed) {
						reject(new Error(`${label} timed out after ${timeoutMs}ms`));
					} else {
						reject(new Error(`${label} failed: ${(stderr || error.message).trim() || error.message}`));
					}
					return;
				}
				resolve(stdout);
			},
		);
	});
}

// Parse a PDF string literal starting at s[i] === '(' (balanced parens, escapes).
function parsePdfLiteral(s, i) {
	let depth = 0;
	let out = "";
	let j = i;
	while (j < s.length) {
		const c = s[j];
		if (c === "\\") {
			const n = s[j + 1];
			if (n === "n") out += "\n";
			else if (n === "r") out += "\r";
			else if (n === "t") out += "\t";
			else if (n === "b") out += "\b";
			else if (n === "f") out += "\f";
			else if (n !== undefined) out += n;
			j += 2;
			continue;
		}
		if (c === "(") {
			depth += 1;
			if (depth > 1) out += c;
			j += 1;
			continue;
		}
		if (c === ")") {
			depth -= 1;
			if (depth === 0) return { value: out, end: j + 1 };
			out += c;
			j += 1;
			continue;
		}
		out += c;
		j += 1;
	}
	return { value: out, end: j };
}

function parseMutoolInfo(text) {
	const info = {};

	const pagesMatch = text.match(/^Pages:\s*(\d+)/m);
	const num_pages = pagesMatch ? Number(pagesMatch[1]) : undefined;

	const idx = text.indexOf("Info object");
	if (idx !== -1) {
		const after = text.slice(idx);
		const dictStart = after.indexOf("<");
		if (dictStart !== -1) {
			const dict = after.slice(dictStart + 1);
			let j = 0;
			while (j < dict.length) {
				if (dict[j] !== "/") {
					j += 1;
					continue;
				}
				let k = j + 1;
				while (k < dict.length && /[A-Za-z0-9_]/.test(dict[k])) k += 1;
				const key = dict.slice(j + 1, k);
				if (!key) {
					j += 1;
					continue;
				}
				if (dict[k] === "(") {
					const lit = parsePdfLiteral(dict, k);
					if (lit) {
						info[key] = lit.value;
						j = lit.end;
						continue;
					}
				} else if (dict[k] === "<") {
					const end = dict.indexOf(">", k + 1);
					if (end !== -1) {
						const hex = dict.slice(k + 1, end).replace(/\s+/g, "");
						if (/^[0-9a-fA-F]*$/.test(hex) && hex.length > 0) {
							const bytes = Buffer.from(hex, "hex");
							let decoded = bytes.toString("utf8").replace(/\u0000/g, "");
							if (decoded.includes("\uFFFD")) {
								decoded = bytes.toString("latin1").replace(/\u0000/g, "");
							}
							info[key] = decoded;
						} else {
							info[key] = dict.slice(k + 1, end);
						}
						j = end + 1;
						continue;
					}
				}
				j = k;
			}
		}
	}

	return { info, num_pages };
}

function parsePageSpec(spec) {
	if (!spec) return [];
	return spec
		.split(",")
		.flatMap((part) => part.trim().split(/\s+/))
		.filter(Boolean);
}

async function runMutool(sources, options) {
	const results = [];
	const notes = [];

	const mcpOnly = [
		["--tables", options.include_tables],
		["--images", options.include_images],
		["--markdown", options.include_markdown],
		["--chunks", options.include_chunks],
		["--annotations", options.include_annotations],
		["--outline", options.include_outline],
		["--page-labels", options.include_page_labels],
		["--ocr-text", options.include_ocr_text_layer],
	];
	for (const [flag, enabled] of mcpOnly) {
		if (enabled) notes.push(`${flag} is only supported by the MCP engine; ignored for mutool engine`);
	}
	if (options.raw) notes.push("--raw only applies to the MCP engine");

	const pages = parsePageSpec(options.pages);

	for (const source of sources) {
		const data = {};
		try {
			if (source.kind === "url") {
				throw new Error(
					"mutool engine cannot fetch URLs (this MuPDF build has no HTTP support); use --engine mcp or download the PDF locally",
				);
			}

			if (options.include_metadata || options.include_page_count) {
				const infoText = await runWithTimeout(
					"mutool",
					["info", source.value],
					options.timeoutMs,
					"mutool info",
				);
				const parsed = parseMutoolInfo(infoText);
				if (options.include_page_count && parsed.num_pages !== undefined) data.num_pages = parsed.num_pages;
				if (options.include_metadata) data.info = parsed.info;
			}

			if (options.include_full_text) {
				const args = ["draw", "-F", "txt", "-o", "-", source.value, ...pages];
				data.full_text = await runWithTimeout("mutool", args, options.timeoutMs, "mutool draw");
			}

			if (options.renderDir) {
				fs.mkdirSync(options.renderDir, { recursive: true });
				const stem =
					path.basename(source.value, path.extname(source.value)).replace(/[^A-Za-z0-9_-]/g, "_") || "page";
				const pattern = path.join(options.renderDir, `${stem}-%d.png`);
				const renderArgs = ["draw", "-F", "png", "-o", pattern, source.value, ...(pages.length ? pages : [])];
				await runWithTimeout("mutool", renderArgs, options.timeoutMs, "mutool render");
				const rendered = fs
					.readdirSync(options.renderDir)
					.filter((f) => f.startsWith(`${stem}-`) && f.endsWith(".png"))
					.sort(
						(a, b) => Number(a.match(/-(\d+)\.png$/)?.[1] || 0) - Number(b.match(/-(\d+)\.png$/)?.[1] || 0),
					);
				data.rendered_pages = rendered.map((f) => path.join(options.renderDir, f));
			}

			results.push({ source: source.value, success: true, data });
		} catch (error) {
			results.push({
				source: source.value,
				success: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	const output = { engine: "mutool", results };
	if (notes.length > 0) output.notes = notes;
	console.log(JSON.stringify(output, null, 2));

	if (results.some((result) => !result.success)) process.exitCode = 1;
}

// --- engine selection ------------------------------------------------------

function chooseEngine(options, sources) {
	if (options.engine === "mcp") return "mcp";
	if (options.engine === "mutool") return "mutool";

	const large = sources.some((source) => {
		if (source.kind !== "path") return false;
		try {
			return fs.statSync(source.value).size > LARGE_FILE_BYTES;
		} catch {
			return false;
		}
	});

	if (large) {
		console.error(
			"[pdf-reader-cli] auto engine: large file detected, using mutool for extraction (MCP has a text-size budget).",
		);
	}
	return large ? "mutool" : "mcp";
}

// --- main ------------------------------------------------------------------

async function main() {
	let parsed;
	try {
		parsed = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error(`Argument error: ${error.message}`);
		printUsage();
		process.exit(2);
	}

	if (parsed.help) {
		printUsage();
		return;
	}

	const { sources, options } = parsed;
	const resolved = sources.map(resolveSource);

	const engine = chooseEngine(options, resolved);

	try {
		if (engine === "mutool") {
			await runMutool(resolved, options);
			return;
		}

		try {
			await runMcp(resolved, options);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const retryable = /budget/i.test(message) && resolved.every((source) => source.kind === "path");
			if (options.engine === "auto" && retryable) {
				console.error(
					"[pdf-reader-cli] MCP text extraction exceeded the server budget; retrying with mutool engine.",
				);
				await runMutool(resolved, options);
			} else {
				throw error;
			}
		}
	} catch (error) {
		console.error(`Failed to read PDF: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}

main();
