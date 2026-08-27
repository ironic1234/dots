import { describe, expect, test } from "bun:test";
import btwExtension, { buildConversationSnapshot, extractAnswer } from "../extensions/btw.ts";

describe("btw helpers", () => {
  test("builds a bounded snapshot from user, assistant, and tool messages", () => {
    const snapshot = buildConversationSnapshot(
      [
        { type: "message", message: { role: "user", content: [{ type: "text", text: "Find the route." }] } },
        { type: "message", message: { role: "assistant", content: [{ type: "text", text: "I found it." }] } },
        { type: "message", message: { role: "tool", content: [{ type: "text", text: "src/routes.ts" }] } },
        { type: "branch_summary", summary: "The route lookup is complete." },
        { type: "custom", customType: "goal-mode-state", data: { status: "active" } },
      ],
      10_000,
    );

    expect(snapshot).toContain("User:\nFind the route.");
    expect(snapshot).toContain("Assistant:\nI found it.");
    expect(snapshot).toContain("Tool:\nsrc/routes.ts");
    expect(snapshot).toContain("Branch summary:\nThe route lookup is complete.");
    expect(snapshot).not.toContain("goal-mode-state");
  });

  test("keeps both ends when the context snapshot is truncated", () => {
    const snapshot = buildConversationSnapshot(
      [
        { type: "message", message: { role: "user", content: [{ type: "text", text: "START " + "x".repeat(300) }] } },
        { type: "message", message: { role: "assistant", content: [{ type: "text", text: "END " + "y".repeat(300) }] } },
      ],
      120,
    );

    expect(snapshot.length).toBeLessThanOrEqual(120);
    expect(snapshot).toContain("START");
    expect(snapshot).toContain("END");
    expect(snapshot).toContain("context truncated");
  });

  test("extracts visible text without leaking thinking blocks", () => {
    const answer = extractAnswer({
      content: [
        { type: "thinking", thinking: "secret reasoning" },
        { type: "text", text: "The answer." },
      ],
    } as any);

    expect(answer).toBe("The answer.");
  });
});

describe("btw command", () => {
  test("answers through the side channel without injecting a main-session message", async () => {
    let handler: ((args: string, ctx: any) => Promise<void>) | undefined;
    let sentMessage = false;
    const notifications: string[] = [];

    btwExtension({
      on: () => {},
      registerCommand: (_name: string, spec: { handler: (args: string, ctx: any) => Promise<void> }) => {
        handler = spec.handler;
      },
    } as any);

    const ctx = {
      mode: "rpc",
      hasUI: true,
      cwd: "/tmp/project",
      model: { provider: "fake", id: "model" },
      modelRegistry: {
        hasConfiguredAuth: () => true,
        complete: async () => ({ stopReason: "stop", content: [{ type: "text", text: "A side answer." }] }),
      },
      sessionManager: { buildContextEntries: () => [] },
      ui: {
        notify: (message: string) => notifications.push(message),
        input: async () => undefined,
        custom: async () => undefined,
      },
      sendMessage: () => {
        sentMessage = true;
      },
    };

    expect(handler).toBeDefined();
    await handler!("What is this?", ctx);

    expect(sentMessage).toBe(false);
    expect(notifications).toEqual(["BTW: A side answer."]);
  });

  test("shows usage when no question is supplied and no UI is available", async () => {
    let handler: ((args: string, ctx: any) => Promise<void>) | undefined;
    const notifications: string[] = [];

    btwExtension({
      on: () => {},
      registerCommand: (_name: string, spec: { handler: (args: string, ctx: any) => Promise<void> }) => {
        handler = spec.handler;
      },
    } as any);

    await handler!("", {
      mode: "print",
      hasUI: false,
      ui: { notify: (message: string) => notifications.push(message) },
    });

    expect(notifications).toEqual(["Usage: /btw <question>"]);
  });
});
