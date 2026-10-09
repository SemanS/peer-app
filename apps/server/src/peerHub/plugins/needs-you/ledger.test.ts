// @effect-diagnostics nodeBuiltinImport:off - the local ledger in a private temporary directory.
import { describe, expect, it } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { fileLedger, emptyLedger } from "./ledger.ts";

describe("local alert ledger", () => {
  it("writes atomically with private permissions and reloads the setting and episode", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-needs-you-"));
    try {
      const io = fileLedger(directory);
      expect(await io.read()).toEqual(emptyLedger());
      const value = {
        version: 1 as const,
        alerts: true,
        published: {
          "peer-needs-you.agent.1234567890abcdef": {
            phase: "waiting_for_input" as const,
            since: "2026-10-09T12:00:00Z",
          },
        },
      };
      await io.write(value);
      expect(await fileLedger(directory).read()).toEqual(value);
      expect((await NodeFSP.stat(NodePath.join(directory, "needs-you.json"))).mode & 0o777).toBe(
        0o600,
      );
      expect(await NodeFSP.readdir(directory)).toEqual(["needs-you.json"]);
      await NodeFSP.writeFile(NodePath.join(directory, "needs-you.json"), "invalid");
      await expect(io.read()).rejects.toThrow("Invalid local Needs You ledger");
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });
});
