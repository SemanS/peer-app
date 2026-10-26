import { describe, expect, it } from "@effect/vitest";

import { PEER_LOCAL_WORKSPACE, PeerHubError } from "@t3tools/contracts";
import type { CliError } from "./cliContract.ts";
import { brokerFixture } from "./testkit.ts";

/** A broker whose checkout is shared (or not yet) and whose person is in `workspaces`. */
async function unshared(workspaces: ReadonlyArray<string>) {
  let shared = false;
  const calls: Array<unknown> = [];
  const fixture = await brokerFixture((host) => ({
    workspaces: () => [...workspaces],
    placeOf: async (cwd) => (shared ? host.placeOf(cwd) : null),
    shareFolder: async (cwd, workspace, name) => {
      calls.push({ cwd, workspace, name });
      shared = true;
      return { project: "vocabulift", name: name ?? "vocabulift" };
    },
  }));
  const headers = { "x-peer-session": "claude:one", "x-peer-cwd": fixture.root };
  const run = (command: string, args: ReadonlyArray<string> = []) =>
    fixture.broker.runCli(command, args, headers);
  const fails = (command: string, args: ReadonlyArray<string> = []) =>
    run(command, args).then(
      () => {
        throw new Error(`peer ${command} succeeded`);
      },
      (error: CliError) => error,
    );
  return { fixture, run, fails, calls, headers };
}

describe("peer share", () => {
  it("tells a session in an unshared project why Peer ignores it, then shares it and lets it in", async () => {
    const { fixture, run, fails, calls } = await unshared(["webinson"]);
    try {
      await fixture.register("one");
      const ignored = await fails("task");
      expect(ignored.outcome).toBe("refused");
      expect(ignored.reason).toContain("is a project only on this computer");
      expect(ignored.next).toContain("peer share");
      expect(await run("share")).toContain("Shared vocabulift with webinson as project vocabulift");
      expect(calls).toEqual([{ cwd: fixture.root, workspace: "webinson", name: undefined }]);
      // Its next step registers the session, without waiting out the ignored folder's minute.
      await fixture.register("one");
      expect(await run("task")).toContain("This project has no tasks.");
      expect(await run("share")).toContain("already is project app of acme");
      expect(calls).toHaveLength(1);
    } finally {
      await fixture.dispose();
    }
  });

  it("shares a Local checkout with a team, excluding Local from team choices and surfacing a binding refusal", async () => {
    const calls: string[] = [];
    let refuse = true;
    const fixture = await brokerFixture((host) => ({
      workspaces: () => [PEER_LOCAL_WORKSPACE, "acme"],
      placeOf: async (cwd) => ({ ...(await host.placeOf(cwd))!, workspace: PEER_LOCAL_WORKSPACE }),
      shareFolder: async (_cwd, workspace) => {
        calls.push(workspace);
        if (refuse)
          throw new PeerHubError({
            detail: "End the active agent runtimes before sharing.",
            refused: true,
          });
        return { project: "app", name: "App" };
      },
    }));
    try {
      const headers = { "x-peer-cwd": fixture.root };
      await expect(fixture.broker.runCli("share", [], headers)).rejects.toMatchObject({
        outcome: "refused",
        reason: "End the active agent runtimes before sharing.",
      });
      refuse = false;
      expect(await fixture.broker.runCli("share", [], headers)).toContain("Shared App with acme");
      expect(calls).toEqual(["acme", "acme"]);
    } finally {
      await fixture.dispose();
    }
  });

  it("asks which workspace when there are several, and refuses one the person is not in", async () => {
    const { fixture, run, fails, calls } = await unshared(["webinson", "acme"]);
    try {
      const which = await fails("share");
      expect(which.outcome).toBe("usage");
      expect(which.reason).toContain("webinson, acme");
      expect((await fails("share", ["--workspace", "other"])).reason).toContain(
        "no workspace other",
      );
      expect((await fails("share", ["vocabulift"])).outcome).toBe("usage");
      await run("share", ["--workspace", "acme", "--name", "Vocabulift"]);
      expect(calls).toEqual([{ cwd: fixture.root, workspace: "acme", name: "Vocabulift" }]);
    } finally {
      await fixture.dispose();
    }
  });
});
