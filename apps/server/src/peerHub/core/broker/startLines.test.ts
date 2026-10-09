// @effect-diagnostics nodeBuiltinImport:off - isolated broker log proof.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { NO_PLUGINS } from "./host.ts";
import { brokerFixture } from "./testkit.ts";

it("adds bounded plugin instructions only to start text and counts the complete context", async () => {
  let on = true;
  const line = "Peer recipes: catch-up. Print one with peer recipe <name>.";
  const fixture = await brokerFixture(() => ({
    plugins: async () => ({
      ...NO_PLUGINS,
      active: on
        ? [
            {
              id: "recipes",
              title: "Recipes",
              contributions: { hooks: { startLine: Effect.succeed(line) } },
            },
          ]
        : [],
    }),
  }));
  try {
    const body = { session_id: "one", cwd: fixture.root };
    const start = await fixture.broker.hook(
      { ...body, hook_event_name: "SessionStart", source: "startup" },
      {},
    );
    const text = JSON.stringify(start);
    expect(text.split(line)).toHaveLength(2);
    expect(text.indexOf(line)).toBeLessThan(
      text.indexOf("working context", text.indexOf(line) + line.length),
    );
    const prompt = await fixture.broker.hook(
      { ...body, hook_event_name: "UserPromptSubmit", prompt: "Continue" },
      {},
    );
    const tool = await fixture.broker.hook(
      {
        ...body,
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: NodePath.join(fixture.root, "README.md") },
      },
      {},
    );
    expect(JSON.stringify(prompt)).not.toContain(line);
    expect(JSON.stringify(tool)).not.toContain(line);
    await fixture.broker.host.log.idle();
    const log = (await NodeFSP.readFile(fixture.debugPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((row) => JSON.parse(row) as { event: string; bytes?: number });
    expect(log.find((row) => row.event === "context.injected")?.bytes).toBeGreaterThan(line.length);
    on = false;
    const disabled = await fixture.broker.hook(
      { session_id: "two", cwd: fixture.root, hook_event_name: "SessionStart", source: "startup" },
      {},
    );
    expect(JSON.stringify(disabled)).not.toContain(line);
  } finally {
    await fixture.dispose();
  }
});
