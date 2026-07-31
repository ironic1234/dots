import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RefreshModelsContext } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import {
  getAgentDir,
  type ExtensionAPI,
  type ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

const PROVIDER_ID = "opencode";
const COST_FIELDS = ["input", "output", "cacheRead", "cacheWrite"] as const;

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null ? (value as RecordValue) : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasZeroRates(value: unknown): boolean {
  const rates = asRecord(value);
  return rates !== undefined && COST_FIELDS.every((field) => rates[field] === 0);
}

function isFreeCost(value: unknown): value is ProviderModelConfig["cost"] {
  const cost = asRecord(value);
  if (!cost || !hasZeroRates(cost)) return false;

  const tiers = cost.tiers;
  return (
    tiers === undefined ||
    (Array.isArray(tiers) &&
      tiers.every(
        (tier) =>
          hasZeroRates(tier) && isFiniteNumber(asRecord(tier)?.inputTokensAbove),
      ))
  );
}

function toModelDefinition(value: unknown): ProviderModelConfig | undefined {
  const model = asRecord(value);
  const id = model?.id;
  const api = model?.api;
  if (typeof id !== "string" || !id || typeof api !== "string" || !isFreeCost(model?.cost)) {
    return undefined;
  }

  const input = Array.isArray(model.input)
    ? model.input.filter(
        (value): value is "text" | "image" => value === "text" || value === "image",
      )
    : [];
  const contextWindow = isFiniteNumber(model.contextWindow) && model.contextWindow > 0
    ? model.contextWindow
    : 128_000;
  const maxTokens = isFiniteNumber(model.maxTokens) && model.maxTokens > 0
    ? model.maxTokens
    : 16_384;

  const definition: ProviderModelConfig = {
    id,
    name: typeof model.name === "string" && model.name ? model.name : id,
    api: api as ProviderModelConfig["api"],
    ...(typeof model.baseUrl === "string" ? { baseUrl: model.baseUrl } : {}),
    reasoning: model.reasoning === true,
    input: input.length > 0 ? input : ["text"],
    cost: model.cost,
    contextWindow,
    maxTokens,
  };

  if (asRecord(model.thinkingLevelMap)) {
    definition.thinkingLevelMap = model.thinkingLevelMap as ProviderModelConfig["thinkingLevelMap"];
  }
  if (asRecord(model.compat)) {
    definition.compat = model.compat as ProviderModelConfig["compat"];
  }

  return definition;
}

function freeModels(entries: readonly unknown[] | undefined): ProviderModelConfig[] | undefined {
  if (entries === undefined) return undefined;

  const unique = new Map<string, ProviderModelConfig>();
  for (const entry of entries) {
    const model = toModelDefinition(entry);
    if (model) unique.set(model.id, model);
  }
  return [...unique.values()];
}

async function readCachedModels(): Promise<readonly unknown[] | undefined> {
  try {
    const content = await readFile(join(getAgentDir(), "models-store.json"), "utf8");
    const opencode = asRecord(asRecord(JSON.parse(content))?.[PROVIDER_ID]);
    return Array.isArray(opencode?.models) ? opencode.models : undefined;
  } catch {
    return undefined;
  }
}

function builtinFreeModels(): ProviderModelConfig[] {
  try {
    return freeModels(getBuiltinModels(PROVIDER_ID)) ?? [];
  } catch {
    return [];
  }
}

async function initialFreeModels(): Promise<ProviderModelConfig[]> {
  const cached = freeModels(await readCachedModels());
  return cached ?? builtinFreeModels();
}

async function refreshedFreeModels(
  context: RefreshModelsContext,
  current: ProviderModelConfig[],
): Promise<ProviderModelConfig[]> {
  if (!context.allowNetwork) return current;

  // The native OpenCode catalog refresh runs first and stores the latest catalog.
  // Filter that refreshed catalog instead of maintaining a second model list.
  try {
    const stored = await context.store.read();
    const refreshed = freeModels(stored?.models);
    return refreshed ?? current;
  } catch {
    return current;
  }
}

export default async function opencodeFreeModels(pi: ExtensionAPI): Promise<void> {
  let currentModels = await initialFreeModels();

  pi.registerProvider(PROVIDER_ID, {
    // Replacing the provider's models makes this a real allowlist, not just a
    // preference for the model picker. The inherited provider still supplies auth
    // and request streaming.
    models: currentModels,
    refreshModels: async (context) => {
      currentModels = await refreshedFreeModels(context, currentModels);
      return currentModels;
    },
  });
}
