import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const STORE_VERSION = 1;
const MAX_MEMORY_CONTENT = 20_000;
const MAX_RETURNED_CONTENT = 4_000;
const DEFAULT_LIMIT = 20;

type MemoryAction = "create" | "edit" | "retrieve";

interface Memory {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface MemoryStore {
  version: number;
  memories: Memory[];
}

interface MemoryDetails {
  action: MemoryAction;
  file: string;
  memory?: Memory;
  memories?: Memory[];
  count?: number;
}

const MemoryParams = Type.Object({
  action: StringEnum(["create", "edit", "retrieve"] as const),
  id: Type.Optional(Type.String({ description: "Memory id, required for edit and optional for retrieve" })),
  title: Type.Optional(Type.String({ description: "Short title for a new or edited memory" })),
  content: Type.Optional(Type.String({ description: "The memory content for create or edit" })),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Optional searchable tags" })),
  query: Type.Optional(Type.String({ description: "Case-insensitive terms to search in ids, titles, content, and tags" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "Maximum memories to return for retrieve" })),
});

function memoryFilePath(): string {
  const configured = process.env.PI_MEMORY_FILE?.trim();
  if (configured) {
    const expanded = configured.startsWith("~/") ? join(homedir(), configured.slice(2)) : configured;
    return isAbsolute(expanded) ? expanded : resolve(expanded);
  }

  const agentDir = process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
  return join(agentDir, "memories.json");
}

function nonEmpty(value: string | undefined, field: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) throw new Error(`memory ${field} is required`);
  return trimmed;
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

function validateStore(value: unknown, file: string): MemoryStore {
  if (!value || typeof value !== "object") throw new Error(`Memory file is not a JSON object: ${file}`);
  const candidate = value as { version?: unknown; memories?: unknown };
  if (!Array.isArray(candidate.memories)) throw new Error(`Memory file is missing a memories array: ${file}`);

  const memories = candidate.memories.map((memory, index) => {
    if (!memory || typeof memory !== "object") throw new Error(`Invalid memory at index ${index}: ${file}`);
    const item = memory as Partial<Memory>;
    if (
      typeof item.id !== "string" ||
      typeof item.title !== "string" ||
      typeof item.content !== "string" ||
      !Array.isArray(item.tags) ||
      !item.tags.every((tag) => typeof tag === "string") ||
      typeof item.createdAt !== "string" ||
      typeof item.updatedAt !== "string"
    ) {
      throw new Error(`Invalid memory at index ${index}: ${file}`);
    }
    return {
      id: item.id,
      title: item.title,
      content: item.content,
      tags: normalizeTags(item.tags),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  });

  return { version: typeof candidate.version === "number" ? candidate.version : STORE_VERSION, memories };
}

async function readStore(file: string): Promise<MemoryStore> {
  try {
    const raw = await readFile(file, "utf8");
    return validateStore(JSON.parse(raw), file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: STORE_VERSION, memories: [] };
    }
    if (error instanceof SyntaxError) throw new Error(`Memory file contains invalid JSON: ${file}`);
    throw error;
  }
}

async function writeStore(file: string, store: MemoryStore): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify({ version: STORE_VERSION, memories: store.memories }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, file);
  } finally {
    try {
      await rename(temporary, file);
    } catch {
      // The temporary file was already renamed, or cleanup is not necessary.
    }
  }
}

function publicMemory(memory: Memory): Memory {
  return {
    ...memory,
    content:
      memory.content.length > MAX_RETURNED_CONTENT
        ? `${memory.content.slice(0, MAX_RETURNED_CONTENT)}… [content truncated]`
        : memory.content,
  };
}

function findMemory(store: MemoryStore, id: string): Memory {
  const memory = store.memories.find((candidate) => candidate.id === id);
  if (!memory) throw new Error(`No memory found with id: ${id}`);
  return memory;
}

function retrieveMemories(store: MemoryStore, id: string | undefined, query: string | undefined, limit: number): Memory[] {
  if (id) return store.memories.filter((memory) => memory.id === id).slice(0, 1);

  const terms = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return store.memories
    .filter((memory) => {
      if (terms.length === 0) return true;
      const haystack = [memory.id, memory.title, memory.content, ...memory.tags].join(" ").toLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

function textResult(text: string, details: MemoryDetails) {
  return { content: [{ type: "text" as const, text }], details };
}

export default function memoryExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "memory",
    label: "Memory",
    description: "Create, edit, or retrieve persistent memories stored in a local JSON file. Retrieve before editing when you do not already know a memory id.",
    promptSnippet: "Create, edit, and retrieve persistent user memories",
    promptGuidelines: [
      "Use memory with action=retrieve when relevant persistent context may exist; do not assume memory contents without retrieving them.",
      "Use memory with action=create for durable facts, preferences, decisions, or project context the user wants remembered.",
      "Use memory with action=edit only after retrieving the target memory or when its exact id is already known.",
    ],
    parameters: MemoryParams,
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const file = memoryFilePath();

      return withFileMutationQueue(file, async () => {
        const store = await readStore(file);
        const now = new Date().toISOString();

        if (params.action === "create") {
          const title = nonEmpty(params.title, "title");
          const content = nonEmpty(params.content, "content");
          if (content.length > MAX_MEMORY_CONTENT) {
            throw new Error(`memory content is limited to ${MAX_MEMORY_CONTENT} characters`);
          }

          const memory: Memory = {
            id: `mem_${randomUUID()}`,
            title,
            content,
            tags: normalizeTags(params.tags),
            createdAt: now,
            updatedAt: now,
          };
          store.memories.push(memory);
          await writeStore(file, store);
          return textResult(`Created memory ${memory.id}: ${memory.title}`, {
            action: params.action,
            file,
            memory: publicMemory(memory),
          });
        }

        if (params.action === "edit") {
          const id = nonEmpty(params.id, "id");
          const memory = findMemory(store, id);
          if (params.title !== undefined) memory.title = nonEmpty(params.title, "title");
          if (params.content !== undefined) {
            memory.content = nonEmpty(params.content, "content");
            if (memory.content.length > MAX_MEMORY_CONTENT) {
              throw new Error(`memory content is limited to ${MAX_MEMORY_CONTENT} characters`);
            }
          }
          if (params.tags !== undefined) memory.tags = normalizeTags(params.tags);
          if (params.title === undefined && params.content === undefined && params.tags === undefined) {
            throw new Error("memory edit requires at least one of title, content, or tags");
          }
          memory.updatedAt = now;
          await writeStore(file, store);
          return textResult(`Updated memory ${memory.id}: ${memory.title}`, {
            action: params.action,
            file,
            memory: publicMemory(memory),
          });
        }

        const memories = retrieveMemories(store, params.id, params.query, params.limit ?? DEFAULT_LIMIT).map(publicMemory);
        if (memories.length === 0) {
          return textResult("No memories found.", { action: params.action, file, memories: [], count: 0 });
        }

        const lines = memories.map((memory) => {
          const tags = memory.tags.length > 0 ? ` [${memory.tags.join(", ")}]` : "";
          return `- ${memory.id}: ${memory.title}${tags}\n  ${memory.content}`;
        });
        return textResult(`Found ${memories.length} memor${memories.length === 1 ? "y" : "ies"}:\n${lines.join("\n")}`, {
          action: params.action,
          file,
          memories,
          count: memories.length,
        });
      });
    },
    renderCall(args, theme) {
      const suffix = args.action === "retrieve" ? (args.query ? ` · ${args.query}` : "") : args.id ? ` · ${args.id}` : "";
      return new Text(theme.fg("toolTitle", theme.bold("memory ")) + theme.fg("accent", `${args.action}${suffix}`), 0, 0);
    },
    renderResult(result, _options, theme) {
      const details = result.details as MemoryDetails | undefined;
      if (details?.action === "retrieve") {
        return new Text(theme.fg("success", `✓ ${details.count ?? 0} memor${details.count === 1 ? "y" : "ies"}`), 0, 0);
      }
      return new Text(theme.fg("success", "✓ Memory saved"), 0, 0);
    },
  });
}
