import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";

const MCP_URL = process.env.ROBINHOOD_MCP_URL ?? "https://agent.robinhood.com/mcp/trading";
const DATA_DIR = path.join(os.homedir(), ".pi", "agent", "extensions", "robinhood-mcp", ".state");
const STATE_FILE = path.join(DATA_DIR, "oauth.json");
const REDIRECT_URI = process.env.ROBINHOOD_MCP_REDIRECT_URI ?? "http://127.0.0.1:3334/callback";

type Stored = {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  state?: string;
  discoveryState?: OAuthDiscoveryState;
};

async function load(): Promise<Stored> {
  try { return JSON.parse(await fs.readFile(STATE_FILE, "utf8")); } catch { return {}; }
}
async function save(patch: Partial<Stored>) {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const next = { ...(await load()), ...patch };
  await fs.writeFile(STATE_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
}
function openUrl(url: URL) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url.toString()] : [url.toString()];
  execFile(cmd, args, () => {});
}

class FileOAuthProvider implements OAuthClientProvider {
  get redirectUrl() { return REDIRECT_URI; }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "pi-coding-agent Robinhood MCP",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "openid profile email",
    };
  }
  async state() { const s = crypto.randomBytes(16).toString("hex"); await save({ state: s }); return s; }
  async clientInformation() { return (await load()).clientInformation; }
  async saveClientInformation(clientInformation: OAuthClientInformationMixed) { await save({ clientInformation }); }
  async tokens() { return (await load()).tokens; }
  async saveTokens(tokens: OAuthTokens) { await save({ tokens }); }
  async codeVerifier() { return (await load()).codeVerifier ?? ""; }
  async saveCodeVerifier(codeVerifier: string) { await save({ codeVerifier }); }
  async redirectToAuthorization(authorizationUrl: URL) { console.log(`\nRobinhood MCP authorization required:\n${authorizationUrl}\n`); openUrl(authorizationUrl); }
  async saveDiscoveryState(discoveryState: OAuthDiscoveryState) { await save({ discoveryState }); }
  async discoveryState() { return (await load()).discoveryState; }
}

export default function (pi: ExtensionAPI) {
  let client: Client | undefined;
  let transport: StreamableHTTPClientTransport | undefined;
  let toolsRegistered = false;

  async function connect() {
    if (client) return client;
    const authProvider = new FileOAuthProvider();
    transport = new StreamableHTTPClientTransport(new URL(MCP_URL), { authProvider });
    const c = new Client({ name: "pi-coding-agent", version: "1.0.0" });
    await c.connect(transport);
    client = c;
    return c;
  }

  async function registerMcpTools(ctx?: any) {
    const c = await connect();
    const listed = await c.listTools();
    for (const t of listed.tools ?? []) {
      const name = `robinhood_${t.name.replace(/[^A-Za-z0-9_]/g, "_")}`;
      pi.registerTool({
        name,
        label: `Robinhood: ${t.name}`,
        description: t.description ?? `Robinhood MCP tool ${t.name}`,
        promptSnippet: `Call Robinhood MCP tool ${t.name}`,
        parameters: Type.Unsafe(t.inputSchema ?? { type: "object", properties: {} }),
        async execute(_id, params, signal) {
          const res = await (await connect()).callTool({ name: t.name, arguments: params as any }, undefined, { signal });
          return { content: (res.content as any) ?? [{ type: "text", text: JSON.stringify(res) }], details: { tool: t.name } };
        },
      });
    }
    toolsRegistered = true;
    ctx?.ui?.notify(`Robinhood MCP loaded ${listed.tools?.length ?? 0} tools`, "info");
  }

  pi.registerCommand("robinhood-auth", {
    description: "Finish Robinhood MCP OAuth with the redirected URL or code",
    handler: async (args, ctx) => {
      const code = args.includes("code=") ? new URL(args).searchParams.get("code") : args.trim();
      if (!code || !transport) { ctx.ui.notify("Run /reload first, authorize in browser, then pass the redirected URL/code.", "error"); return; }
      await transport.finishAuth(code);
      client = undefined;
      if (!toolsRegistered) await registerMcpTools(ctx);
      ctx.ui.notify("Robinhood MCP authenticated.", "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    try { if (!toolsRegistered) await registerMcpTools(ctx); }
    catch (e: any) {
      if (e instanceof UnauthorizedError || e?.name === "UnauthorizedError") ctx.ui.notify("Robinhood MCP needs auth. Browser opened; after login run /robinhood-auth <redirected URL or code> then /reload.", "warning");
      else ctx.ui.notify(`Robinhood MCP failed: ${e?.message ?? e}`, "error");
    }
  });

  pi.on("session_shutdown", async () => { try { await transport?.close(); } catch {} client = undefined; transport = undefined; });
}
