// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - temporary broker evidence.
import * as NodeFSP from "node:fs/promises";
import { it, expect } from "vite-plus/test";
import { brokerFixture } from "./testkit.ts";
import { taskRef } from "@t3tools/shared/peerRef";
import { stampOf } from "./log.ts";
it("stamps adapters by handshake and logs title-shaped task ids exactly once as shared references", async () => {
  const f = await brokerFixture(() => ({ taskOf: () => "SENTINEL-title-1234" }));
  try {
    await f.register("one");
    const claude = f.broker.sessions.get("claude:one")!;
    expect(stampOf(claude).adapter).toBe("claude_hooks");
    claude.modAt = 1; // A stale handshake still identifies the adapter.
    expect(stampOf(claude).adapter).toBe("claude_mod");
    await f.broker["sessionFor"]("codex", { session_id: "two", cwd: f.root }, undefined);
    expect(stampOf(f.broker.sessions.get("codex:two")!).adapter).toBe("codex_hooks");
    f.broker.record("session.started", {
      session: claude.id,
      task: "SENTINEL-title-1234",
      root: "/SENTINEL-path",
      transcript: "/SENTINEL-transcript",
      label: "SENTINEL-prompt",
    });
    await f.broker.host.log.idle();
    const main = await NodeFSP.readFile(f.broker.host.logPath, "utf8"),
      detail = await NodeFSP.readFile(f.debugPath, "utf8");
    expect(main).not.toContain("SENTINEL");
    expect(main).toContain(taskRef("SENTINEL-title-1234"));
    expect(detail).toContain("SENTINEL-title-1234");
  } finally {
    await f.dispose();
  }
});
