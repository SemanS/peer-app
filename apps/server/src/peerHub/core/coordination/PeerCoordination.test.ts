// @effect-diagnostics nodeBuiltinImport:off - stub CLIs in a temporary folder on PATH.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { vi } from "vite-plus/test";

import type { PeerContributions, PeerRuntimeProvider, ReportedSession } from "../plugin.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import { brokerPlugins, resumeNative } from "./PeerCoordination.ts";

const session = (id: string): ReportedSession => ({
  id,
  project: "app",
  label: id,
  status: "working",
  files: [],
  claims: [],
});

/** A plugin's contribution that adds one session to every report. */
const adding = (id: string, more: Partial<PeerContributions> = {}): PeerContributions => ({
  ...more,
  reportSessions: (_workspace, reported) => Effect.succeed([...reported, session(id)]),
});

describe("what plugins give the broker", () => {
  it.effect("adds the runtime's sessions to a report after every other plugin's", () =>
    Effect.gen(function* () {
      // herdr comes first in the registry and fits its observations within the Hub's bound.
      const given = yield* brokerPlugins.pipe(
        Effect.provide(
          Layer.mock(PeerPlugins.PeerPlugins)({
            active: Effect.succeed([
              {
                id: "herdr",
                title: "herdr",
                contributions: adding("observed", { runtime: {} as PeerRuntimeProvider }),
              },
              { id: "memory", title: "Peer Memory", contributions: adding("app-runtime") },
            ]),
            built: Effect.succeed([]),
            excluded: Effect.succeed([{ plugin: "ask", name: "ask", refused: "off" }]),
          }),
        ),
      );
      assert.deepStrictEqual(given.excluded, [{ plugin: "ask", name: "ask", refused: "off" }]);
      assert.deepStrictEqual(
        given.reportSessions.map(({ plugin }) => plugin),
        ["memory", "herdr"],
      );
      let reported: ReadonlyArray<ReportedSession> = [];
      for (const { add } of given.reportSessions) reported = yield* add("acme", reported);
      assert.deepStrictEqual(
        reported.map(({ id }) => id),
        ["app-runtime", "observed"],
      );
    }),
  );
});

describe("resuming an ended conversation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** A folder with stub `claude` and `codex` that write where they ran and with what, then act on `STUB_MODE`. */
  async function stubs() {
    const dir = await NodeFSP.realpath(
      await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-resume-")),
    );
    const bin = NodePath.join(dir, "bin");
    const cwd = NodePath.join(dir, "checkout");
    await NodeFSP.mkdir(bin);
    await NodeFSP.mkdir(cwd);
    const out = NodePath.join(dir, "args");
    const script = [
      "#!/bin/sh",
      `{ pwd; for arg in "$@"; do printf '%s\\n' "$arg"; done; } > "${out}"`,
      'case "$STUB_MODE" in',
      '  fail) echo "No conversation found with session ID" >&2; exit 3 ;;',
      "  slow) exec sleep 10 ;;",
      "esac",
    ].join("\n");
    for (const name of ["claude", "codex"]) {
      await NodeFSP.writeFile(NodePath.join(bin, name), script, { mode: 0o755 });
    }
    vi.stubEnv("PATH", `${bin}${NodePath.delimiter}${process.env.PATH ?? ""}`);
    const ran = async () => (await NodeFSP.readFile(out, "utf8")).trim().split("\n");
    const dispose = () => NodeFSP.rm(dir, { recursive: true, force: true });
    return { cwd, ran, dispose };
  }

  it("runs Claude Code and Codex in the session's folder with the nudge as the prompt", async () => {
    const stub = await stubs();
    try {
      const claude = await resumeNative("claude", "abc", stub.cwd, "Close it", { timeoutMs: 5000 });
      assert.deepStrictEqual(claude, { status: "ended", exit: 0 });
      assert.deepStrictEqual(await stub.ran(), [stub.cwd, "-p", "--resume", "abc", "Close it"]);
      const codex = await resumeNative("codex", "t-1", stub.cwd, "Close it", { timeoutMs: 5000 });
      assert.strictEqual(codex.status, "ended");
      assert.deepStrictEqual(await stub.ran(), [stub.cwd, "exec", "resume", "t-1", "Close it"]);
    } finally {
      await stub.dispose();
    }
  });

  it("fails with the exit status and what the CLI said", async () => {
    const stub = await stubs();
    vi.stubEnv("STUB_MODE", "fail");
    try {
      assert.deepStrictEqual(
        await resumeNative("claude", "gone", stub.cwd, "x", { timeoutMs: 5000 }),
        {
          status: "failed",
          exit: 3,
          reason: "exited with 3",
          stderr: "No conversation found with session ID",
        },
      );
    } finally {
      await stub.dispose();
    }
  });

  it("stops a resumption that runs past its time", async () => {
    const stub = await stubs();
    vi.stubEnv("STUB_MODE", "slow");
    try {
      const outcome = await resumeNative("claude", "abc", stub.cwd, "x", { timeoutMs: 200 });
      assert.deepStrictEqual(outcome, { status: "timeout", exit: null, reason: "timed out" });
    } finally {
      await stub.dispose();
    }
  });

  it("spawns nothing when resumption is off for this Peer", async () => {
    const stub = await stubs();
    vi.stubEnv("PEER_SETTLE_RESUME", "off");
    try {
      const outcome = await resumeNative("claude", "abc", stub.cwd, "x", { timeoutMs: 5000 });
      assert.deepStrictEqual(outcome, { status: "failed", exit: null, reason: "off" });
      await NodeFSP.access(NodePath.join(NodePath.dirname(stub.cwd), "args")).then(
        () => assert.fail("the stub ran"),
        () => undefined,
      );
    } finally {
      await stub.dispose();
    }
  });
});
