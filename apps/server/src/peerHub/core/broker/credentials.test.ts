// @effect-diagnostics nodeBuiltinImport:off - credentials and the broker's temporary socket.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";

import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

import { CoordinationBroker } from "./Broker.ts";
import { brokerFixture } from "./testkit.ts";

describe("who a peer command acts for", () => {
  it("requires the named session and its current token, binding first use", async () => {
    const fixture = await brokerFixture();
    try {
      await fixture.register("one");
      const session = fixture.broker.sessions.get("claude:one")!;
      const headers = { "x-peer-session": "one" };
      await expect(fixture.broker.runCli("release", [], {})).rejects.toMatchObject({
        outcome: "refused",
        reason: expect.stringContaining("does not come"),
      });
      await expect(
        fixture.broker.runCli("release", [], { "x-peer-session": "unknown" }),
      ).rejects.toMatchObject({
        outcome: "refused",
        reason: expect.stringContaining("no registered"),
      });
      expect(await fixture.broker.runCli("release", [], headers)).toBe("Released all claims.");
      expect(session.credential).toBeUndefined();
      await fixture.broker.runCli("release", [], { ...headers, "x-peer-session-token": "token-a" });
      expect(session.credential).toEqual(
        NodeCrypto.createHash("sha256").update("token-a").digest(),
      );
      session.claims = ["pay.ts"];
      await expect(fixture.broker.runCli("release", [], headers)).rejects.toMatchObject({
        outcome: "refused",
        reason: expect.stringContaining("missing"),
      });
      await expect(
        fixture.broker.runCli("release", [], { ...headers, "x-peer-session-token": "token-b" }),
      ).rejects.toMatchObject({
        outcome: "refused",
        reason: expect.stringContaining("earlier run"),
      });
      expect(session.claims).toEqual(["pay.ts"]);
      await fixture.broker.runCli("release", [], { ...headers, "x-peer-session-token": "token-a" });
      expect(session.claims).toEqual([]);
      vi.stubEnv("PEER_CLI_CREDENTIAL", "session-id");
      await fixture.broker.runCli("release", [], headers);
      await fixture.broker.runCli("release", [], { ...headers, "x-peer-session-token": "token-b" });
      await expect(fixture.broker.runCli("release", [], {})).rejects.toMatchObject({
        outcome: "refused",
      });
    } finally {
      vi.unstubAllEnvs();
      await fixture.dispose();
    }
  });

  it("never guesses a writer from its pane, checkout or recent Bash hook", async () => {
    const note = vi.fn();
    const fixture = await brokerFixture(() => ({ note }));
    try {
      await fixture.register("one");
      const session = fixture.broker.sessions.get("claude:one")!;
      session.pane = "pane-a";
      session.pending.push("unheard note");
      const before = {
        pending: [...session.pending],
        announced: new Set(session.memory.announced),
      };
      for (const afterHook of [false, true]) {
        if (afterHook)
          await fixture.broker.hook(
            {
              session_id: "one",
              cwd: fixture.root,
              hook_event_name: "PreToolUse",
              tool_name: "Bash",
              tool_input: { command: "peer note hello" },
            },
            {},
          );
        const at = session.lastActivity;
        await expect(
          fixture.broker.runCli("note", ["hello"], {
            "x-peer-cwd": fixture.root,
            "x-herdr-pane": "pane-a",
          }),
        ).rejects.toMatchObject({ outcome: "refused" });
        expect(session.lastActivity).toBe(at);
      }
      expect(note).not.toHaveBeenCalled();
      expect(session.pending).toEqual(before.pending);
      expect(session.memory.announced).toEqual(before.announced);
      const next = await fixture.broker.hook(
        {
          session_id: "one",
          cwd: fixture.root,
          hook_event_name: "UserPromptSubmit",
          prompt: "continue",
        },
        {},
      );
      expect(JSON.stringify(next)).toContain("unheard note");
    } finally {
      await fixture.dispose();
    }
  });

  it("rebinds first use after restart and ignores a duplicate settings SessionStart", async () => {
    const fixture = await brokerFixture();
    try {
      const body = {
        session_id: "one",
        cwd: fixture.root,
        hook_event_name: "SessionStart",
        source: "startup",
      };
      await fixture.broker.hook(body, {
        "x-peer-adapter": "mod",
        "x-peer-session-token": "mod-token",
      });
      await fixture.broker.hook(body, { "x-peer-session-token": "settings-token" });
      await fixture.broker.runCli("release", [], {
        "x-peer-session": "one",
        "x-peer-session-token": "mod-token",
      });
      await expect(
        fixture.broker.runCli("release", [], {
          "x-peer-session": "one",
          "x-peer-session-token": "settings-token",
        }),
      ).rejects.toMatchObject({ outcome: "refused" });
      // A new broker has no record of the old process's token. Its first command supplies it again.
      await fixture.broker.stop();
      const restarted = new CoordinationBroker(fixture.broker.host);
      try {
        await restarted.sessionFor("claude", { session_id: "one", cwd: fixture.root }, undefined);
        expect(restarted.sessions.get("claude:one")?.credential).toBeUndefined();
        await restarted.runCli("release", [], {
          "x-peer-session": "one",
          "x-peer-session-token": "mod-token",
        });
        await expect(
          restarted.runCli("release", [], { "x-peer-session": "one" }),
        ).rejects.toMatchObject({ reason: expect.stringContaining("missing") });
        expect(JSON.stringify(restarted.reportFor("acme"))).not.toContain("mod-token");
      } finally {
        await restarted.stop();
      }
    } finally {
      await fixture.dispose();
    }
  });

  it("rotates on start, survives compaction and forgets at SessionEnd without disclosing a token", async () => {
    const fixture = await brokerFixture();
    try {
      const body = {
        session_id: "one",
        cwd: fixture.root,
        hook_event_name: "SessionStart",
        source: "startup",
      };
      const a = "secret-a";
      const b = "secret-b";
      const answer = await fixture.broker.hook(body, { "x-peer-session-token": a });
      const header = { "x-peer-session": "one", "x-peer-session-token": a };
      await fixture.broker.runCli("release", [], header);
      await fixture.broker.hook({ ...body, source: "resume" }, { "x-peer-session-token": b });
      await expect(fixture.broker.runCli("release", [], header)).rejects.toMatchObject({
        reason: expect.stringContaining("earlier run"),
      });
      await fixture.broker.hook({ ...body, source: "compact" }, {});
      await fixture.broker.runCli("release", [], { ...header, "x-peer-session-token": b });
      await fixture.broker.hook(body, {});
      await fixture.broker.runCli("release", [], { "x-peer-session": "one" });
      await fixture.broker.host.log.idle();
      const log = await NodeFSP.readFile(fixture.debugPath, "utf8");
      expect(log).toContain("credential.bound");
      expect(log).toContain("cli.id-only");
      for (const text of [JSON.stringify(answer), JSON.stringify(fixture.broker.snapshot()), log]) {
        expect(text).not.toContain(a);
        expect(text).not.toContain(b);
      }
      await fixture.broker.hook({ ...body, hook_event_name: "SessionEnd" }, {});
      await expect(fixture.broker.runCli("release", [], header)).rejects.toMatchObject({
        reason: expect.stringContaining("no registered"),
      });
    } finally {
      await fixture.dispose();
    }
  });

  it("accepts only a registered Codex thread and records its id-only calls", async () => {
    const fixture = await brokerFixture();
    try {
      await fixture.broker.sessionFor(
        "codex",
        { session_id: "thread", cwd: fixture.root },
        undefined,
      );
      await fixture.broker.runCli("release", [], { "x-peer-session": "thread" });
      expect(fixture.broker.sessions.get("codex:thread")?.credential).toBeUndefined();
      await expect(
        fixture.broker.runCli("release", [], { "x-peer-session": "other" }),
      ).rejects.toMatchObject({ next: expect.stringContaining("trust Peer's hooks") });
      await fixture.broker.host.log.idle();
      expect(await NodeFSP.readFile(fixture.debugPath, "utf8")).toContain('"agent":"codex"');
    } finally {
      await fixture.dispose();
    }
  });

  it("public reads preserve all agent state and context reads record no receipt", async () => {
    const contextRead = vi.fn();
    const fixture = await brokerFixture(() => ({ contextRead }));
    try {
      await fixture.register("one");
      const session = fixture.broker.sessions.get("claude:one")!;
      session.claims = ["pay.ts"];
      session.pending.push("unheard note");
      const before = JSON.stringify(fixture.broker.snapshot());
      const caller = { "x-peer-cwd": fixture.root, "x-herdr-pane": "matched" };
      for (const command of ["status", "index", "context"])
        expect(await fixture.broker.runCli(command, [], caller)).toBeTypeOf("string");
      expect(contextRead).not.toHaveBeenCalled();
      expect(JSON.stringify(fixture.broker.snapshot())).toBe(before);
      expect(session.pending).toEqual(["unheard note"]);
    } finally {
      await fixture.dispose();
    }
  });
});
