// @effect-diagnostics nodeBuiltinImport:off - isolated checkout binding and enrollment races.
import * as NodeFSP from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { PEER_LOCAL_WORKSPACE } from "@t3tools/contracts";
import { brokerFixture } from "./testkit.ts";
import { run } from "../local.ts";

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("checkout authority changes", () => {
  it.each([PEER_LOCAL_WORKSPACE, "acme"])(
    "refuses binding changes while %s has a live runtime",
    async (workspace) => {
      const fixture = await brokerFixture((host) => ({
        placeOf: async (cwd) => ({ ...(await host.placeOf(cwd))!, workspace }),
      }));
      try {
        await fixture.register("one");
        await expect(fixture.broker.beginCheckoutChange(fixture.root)).rejects.toMatchObject({
          refused: true,
        });
        expect(fixture.broker.sessions.get("claude:one")?.workspace).toBe(workspace);
        fixture.broker.sessions.delete("claude:one");
        const release = await fixture.broker.beginCheckoutChange(fixture.root);
        release();
        await fixture.register("two");
        expect(fixture.broker.sessions.has("claude:two")).toBe(true);
      } finally {
        await fixture.dispose();
      }
    },
  );

  it.each([
    [PEER_LOCAL_WORKSPACE, "acme"],
    ["acme", PEER_LOCAL_WORKSPACE],
  ])(
    "fences an enrollment resolving %s while the authority changes to %s",
    async (before, after) => {
      const entered = deferred<void>();
      const resolved = deferred<void>();
      let workspace = before;
      let first = true;
      const fixture = await brokerFixture((host) => ({
        placeOf: async (cwd) => {
          const place = { ...(await host.placeOf(cwd))!, workspace };
          if (first) {
            first = false;
            entered.resolve();
            await resolved.promise;
          }
          return place;
        },
      }));
      try {
        const enrolling = fixture.register("one");
        await entered.promise;
        const release = await fixture.broker.beginCheckoutChange(fixture.root);
        workspace = after;
        resolved.resolve();
        release();
        await enrolling;
        expect(fixture.broker.sessions.get("claude:one")?.workspace).toBe(after);
      } finally {
        await fixture.dispose();
      }
    },
  );

  it("guards live runtimes in linked worktrees of the same repository", async () => {
    const fixture = await brokerFixture();
    const linked = `${fixture.root}-linked`;
    try {
      await run("git", ["init", fixture.root]);
      await run("git", [
        "-C",
        fixture.root,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.test",
        "commit",
        "--allow-empty",
        "-m",
        "Initial",
      ]);
      await run("git", ["-C", fixture.root, "worktree", "add", "-b", "linked", linked]);
      await fixture.register("one");
      await expect(fixture.broker.beginCheckoutChange(linked)).rejects.toMatchObject({
        refused: true,
      });
    } finally {
      await NodeFSP.rm(linked, { recursive: true, force: true });
      await fixture.dispose();
    }
  });
});
