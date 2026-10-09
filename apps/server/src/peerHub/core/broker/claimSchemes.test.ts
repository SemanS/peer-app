import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { NO_PLUGINS } from "./host.ts";
import { brokerFixture } from "./testkit.ts";
import { usage, type PeerContributions } from "../plugin.ts";
const withScheme = (contributions: PeerContributions) => ({
  ...NO_PLUGINS,
  active: [{ id: "resources" as const, title: "Resources", contributions }],
});
describe("optional claim schemes and policy fallbacks", () => {
  it("validates the entire resource/file invocation before either side mutates", async () => {
    const run = vi.fn((_command: string, _input: unknown) =>
      Effect.succeed("Held resource:deploy."),
    );
    const scheme = {
      prefix: "resource:",
      flags: ["--ttl" as const],
      help: ["claim resource:<name> [--ttl 30m]", "release resource:<name>"],
      validate: (_command: "claim" | "release", input: { plain: ReadonlyArray<string> }) => {
        if (input.plain.includes("resource:bad name")) throw usage("bad name", "retry");
      },
      recognizesRelease: (_session: unknown, target: string) =>
        target.startsWith("resource:") || target.startsWith("migrations/"),
      run,
    };
    const fixture = await brokerFixture(() => ({
      plugins: async () => withScheme({ claimScheme: scheme }),
    }));
    try {
      await fixture.register("one");
      const session = fixture.broker.sessions.get("claude:one")!;
      const headers = { "x-peer-session": session.id };
      await expect(
        fixture.broker.runCli("claim", ["resource:deploy", "../outside"], headers),
      ).rejects.toThrow("inside");
      await expect(
        fixture.broker.runCli("claim", ["src/a.ts", "resource:bad name"], headers),
      ).rejects.toThrow("bad name");
      expect(session.claims).toEqual([]);
      expect(run).not.toHaveBeenCalled();
      session.intent = "file intent";
      expect(
        await fixture.broker.runCli(
          "claim",
          ["resource:deploy", "--ttl", "30m", "--intent", "deploying"],
          headers,
        ),
      ).toBe("Held resource:deploy.");
      expect(session.intent).toBe("file intent");
      expect(session.claims).toEqual([]);
      expect(
        await fixture.broker.runCli("claim", ["resource:deploy", "src/a.ts"], headers),
      ).toContain("src/a.ts");
      expect(session.claims).toEqual(["src/a.ts"]);
      await fixture.broker.runCli("release", [], headers);
      expect(run.mock.calls.at(-1)?.[0]).toBe("release");
      expect(session.claims).toEqual([]);
      expect(await fixture.broker.help()).toContain("claim resource:<name>");
    } finally {
      await fixture.dispose();
    }
  });
  it("groups unavailable-Hub files by effective policy and also applies at the hook deadline", async () => {
    let active = true;
    const fallbackPolicy = (_session: unknown, path: string) =>
      path.startsWith("migrations/") ? ("exclusive" as const) : ("notify" as const);
    const fixture = await brokerFixture(() => ({
      plugins: async () => (active ? withScheme({ fallbackPolicy }) : NO_PLUGINS),
      intent: async () => {
        throw new Error("offline");
      },
    }));
    try {
      await fixture.register("one");
      const session = fixture.broker.sessions.get("claude:one")!;
      const result = await fixture.broker.decideEdits(session, [
        "docs/a.md",
        "migrations/b.sql",
        "migrations/c.sql",
      ]);
      expect(result.answers.find((a) => a.file === "migrations/b.sql")?.answer.decision).toBe(
        "deny",
      );
      expect(result.answers.find((a) => a.file === "docs/a.md")?.answer.decision).toBeUndefined();
      expect(result.answers.find((a) => a.file === "migrations/c.sql")?.policy).toBe("exclusive");
      expect(
        await fixture.broker.runCli(
          "claim",
          ["docs/a.md", "migrations/b.sql", "migrations/c.sql"],
          { "x-peer-session": session.id },
        ),
      ).toContain("migrations/c.sql: held");
      const output = fixture.broker.unverifiedTool(
        {
          session_id: "one",
          tool_name: "Write",
          tool_input: { file_path: `${fixture.root}/migrations/b.sql` },
        },
        {},
        await fixture.broker.host.plugins(),
      );
      expect(JSON.stringify(output)).toContain("deny");
      active = false;
      expect(
        (await fixture.broker.decideEdits(session, ["migrations/b.sql"])).answers[0]?.answer
          .decision,
      ).toBeUndefined();
    } finally {
      await fixture.dispose();
    }
  });
});
