#!/usr/bin/env bun

import { spawn } from 'node:child_process';
import path from 'node:path';

function printUsage() {
  console.log(`Usage:\n  read-pdf.mjs <path-or-url> [options]\n\nOptions:\n  --pages <spec>         Page selection (e.g. \"1-5,8\")\n  --text                 Include full text (default: true)\n  --no-text              Disable full text\n  --metadata             Include metadata (default: true)\n  --no-metadata          Disable metadata\n  --page-count           Include page count (default: true)\n  --no-page-count        Disable page count\n  --images               Include image info\n  --tables               Include table extraction\n  --raw                  Print raw MCP tools/call response\n  --timeout <ms>         Timeout per request (default: 120000)\n  -h, --help             Show this help\n`);
}

function parseArgs(argv) {
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    return { help: true };
  }

  const sourceArg = argv[0];
  const options = {
    include_full_text: true,
    include_metadata: true,
    include_page_count: true,
    include_images: false,
    include_tables: false,
    pages: undefined,
    raw: false,
    timeoutMs: 120000,
  };

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--pages') {
      const value = argv[++i];
      if (!value) throw new Error('--pages requires a value');
      options.pages = value;
      continue;
    }

    if (arg === '--text') {
      options.include_full_text = true;
      continue;
    }
    if (arg === '--no-text') {
      options.include_full_text = false;
      continue;
    }

    if (arg === '--metadata') {
      options.include_metadata = true;
      continue;
    }
    if (arg === '--no-metadata') {
      options.include_metadata = false;
      continue;
    }

    if (arg === '--page-count') {
      options.include_page_count = true;
      continue;
    }
    if (arg === '--no-page-count') {
      options.include_page_count = false;
      continue;
    }

    if (arg === '--images') {
      options.include_images = true;
      continue;
    }

    if (arg === '--tables') {
      options.include_tables = true;
      continue;
    }

    if (arg === '--raw') {
      options.raw = true;
      continue;
    }

    if (arg === '--timeout') {
      const value = argv[++i];
      if (!value) throw new Error('--timeout requires a value in milliseconds');
      const ms = Number.parseInt(value, 10);
      if (!Number.isFinite(ms) || ms <= 0) throw new Error(`Invalid --timeout value: ${value}`);
      options.timeoutMs = ms;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { sourceArg, options };
}

function isUrl(input) {
  return /^https?:\/\//i.test(input);
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);

    if (typeof timer.unref === 'function') {
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
  let buffer = '';
  let nextId = 1;
  const pending = new Map();

  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;

    while (true) {
      const nl = buffer.indexOf('\n');
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

  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });

  proc.on('exit', (code, signal) => {
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

    send({ jsonrpc: '2.0', id, method, params });
    const response = await withTimeout(responsePromise, timeoutMs, `${method} response`);

    if (response.error) {
      const message = response.error.message || JSON.stringify(response.error);
      throw new Error(`${method} failed: ${message}`);
    }

    return response.result;
  };

  const notify = (method, params) => {
    send({ jsonrpc: '2.0', method, params });
  };

  return { request, notify };
}

function pickStructuredOutput(toolResult) {
  const content = Array.isArray(toolResult?.content) ? toolResult.content : [];
  const firstJsonText = content.find(
    (item) => item?.type === 'text' && typeof item.text === 'string' && item.text.trim().startsWith('{'),
  );

  if (!firstJsonText) return toolResult;

  try {
    return JSON.parse(firstJsonText.text);
  } catch {
    return toolResult;
  }
}

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

  const { sourceArg, options } = parsed;

  const source = isUrl(sourceArg)
    ? { url: sourceArg }
    : { path: path.isAbsolute(sourceArg) ? sourceArg : path.resolve(process.cwd(), sourceArg) };

  if (options.pages) {
    source.pages = options.pages;
  }

  const toolArguments = {
    sources: [source],
    include_full_text: options.include_full_text,
    include_metadata: options.include_metadata,
    include_page_count: options.include_page_count,
    include_images: options.include_images,
    include_tables: options.include_tables,
  };

  const proc = spawn('bunx', ['@sylphx/pdf-reader-mcp'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MCP_TRANSPORT: 'stdio',
    },
  });

  const client = createRpcClient(proc, options.timeoutMs);

  try {
    await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'pi-pdf-reader-cli', version: '1.0.0' },
    });

    client.notify('notifications/initialized');

    const toolResult = await client.request('tools/call', {
      name: 'read_pdf',
      arguments: toolArguments,
    });

    const output = options.raw ? toolResult : pickStructuredOutput(toolResult);
    console.log(JSON.stringify(output, null, 2));

    if (toolResult?.isError) {
      process.exitCode = 1;
    }
  } finally {
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL');
    }, 500).unref();
  }
}

main().catch((error) => {
  console.error(`Failed to read PDF: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
