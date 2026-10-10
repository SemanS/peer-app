// @effect-diagnostics nodeBuiltinImport:off - exercise the packaged plugin's real filesystem boundary in isolated temporary directories.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, expect, it } from "@effect/vitest";

import {
  claudeModFiles,
  namesClaudeMod,
  peerClaudeModPath,
  refreshClaudeMod,
  removeClaudeMod,
  supportsClaudeMod,
  withClaudeMod,
  writeClaudeMod,
} from "./install.ts";

describe("Claude Mod activation", () => {
  it("requires a build with the verified Unix socket API", () => {
    for (const version of ["2.1.286", "2.1.287", "2.1.290", "2.0.999", "invalid"]) {
      assert.isFalse(supportsClaudeMod(version));
    }
    for (const version of ["2.1.291 (Claude Code)", "2.1.300", "2.2.0", "3.0.0"]) {
      assert.isTrue(supportsClaudeMod(version));
    }
  });

  it("adds one inline package and reversibly preserves unrelated settings", () => {
    const directory = peerClaudeModPath("/peer/data/coord");
    const original = {
      model: "claude-test",
      env: { PRIVATE_SETTING: "preserved", CLAUDE_CODE_PLUGIN_DIRS: "/other/a:/other/b" },
      hooks: { Stop: [{ hooks: [{ command: "/other/hook" }] }] },
    };
    const active = withClaudeMod(original, directory, true);
    assert.deepStrictEqual(withClaudeMod(active, directory, true), active);
    assert.deepStrictEqual(withClaudeMod(active, directory, false), original);
    assert.deepStrictEqual(withClaudeMod(withClaudeMod({}, directory, true), directory, false), {});
    assert.deepStrictEqual(original.env, {
      PRIVATE_SETTING: "preserved",
      CLAUDE_CODE_PLUGIN_DIRS: "/other/a:/other/b",
    });
  });

  it("refuses malformed existing env settings instead of losing them", () => {
    assert.throws(() => withClaudeMod({ env: [] }, "/peer/claude-mod", true));
    assert.throws(() =>
      withClaudeMod({ env: { CLAUDE_CODE_PLUGIN_DIRS: ["/other"] } }, "/peer/claude-mod", true),
    );
  });

  it("escapes socket paths as JavaScript data", () => {
    const socketPath = "/tmp/peer 'quoted' $& $` $'.sock";
    const peerScript = "/peer 'quoted' $& $` $'/bin/peer";
    const files = claudeModFiles({ socketPath, peerScript });
    assert.include(files["hooks/register.js"]!, `let socketPath = ${JSON.stringify(socketPath)}`);
    assert.include(
      files["hooks/register.js"]!,
      `const peerBin = ${JSON.stringify(NodePath.dirname(peerScript))}`,
    );
    assert.notInclude(files["hooks/register.js"]!, "__PEER_SOCKET__");
    assert.notInclude(files["hooks/register.js"]!, "__PEER_BIN__");
    assert.throws(() => claudeModFiles({ socketPath: "relative", peerScript: "/peer/bin/peer" }));
    assert.throws(() =>
      claudeModFiles({ socketPath: "/bad\0socket", peerScript: "/peer/bin/peer" }),
    );
  });

  it("writes an idempotent private package and removes it without touching sibling plugins", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-mod-install-"));
    try {
      const directory = peerClaudeModPath(root);
      const other = NodePath.join(root, "other-plugin");
      await NodeFSP.mkdir(other);
      await NodeFSP.writeFile(NodePath.join(other, "keep"), "unrelated");
      const input = {
        directory,
        socketPath: NodePath.join(root, "broker.sock"),
        peerScript: NodePath.join(root, "bin", "peer"),
      };
      await writeClaudeMod(input);
      const path = NodePath.join(directory, "hooks", "register.js");
      const before = await NodeFSP.stat(path);
      await writeClaudeMod(input);
      assert.strictEqual((await NodeFSP.stat(path)).mtimeMs, before.mtimeMs);
      assert.strictEqual(before.mode & 0o777, 0o600);
      const source = await NodeFSP.readFile(path, "utf8");
      assert.include(source, "argumentHint");
      assert.include(source, "cli($, 'recipe'");
      assert.include(source, "X-Peer-Adapter");
      assert.include(source, "model-input");
      await removeClaudeMod(directory);
      await removeClaudeMod(directory);
      assert.strictEqual(await NodeFSP.readFile(NodePath.join(other, "keep"), "utf8"), "unrelated");
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

  it("finds Peer's directory among the plugin directories a setting or an environment names", () => {
    const directory = peerClaudeModPath("/peer/data/coord");
    assert.isTrue(namesClaudeMod(`/other${NodePath.delimiter}${directory}`, directory));
    assert.isFalse(namesClaudeMod(`${directory}-old`, directory));
    assert.isFalse(namesClaudeMod(undefined, directory));
    assert.isFalse(namesClaudeMod([directory], directory));
  });

  it("keeps a package settings do not name current but idle, and an installed one active", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-mod-refresh-"));
    try {
      const input = {
        directory: peerClaudeModPath(root),
        socketPath: NodePath.join(root, "broker.sock"),
        peerScript: NodePath.join(root, "bin", "peer"),
      };
      // Nothing is there and settings do not name it: nothing is created.
      assert.isFalse(await refreshClaudeMod({ ...input, install: false }));
      await expect(NodeFSP.access(input.directory)).rejects.toThrow();
      // An older Peer's package, which Claude Code may load through its environment.
      await writeClaudeMod(input);
      const path = NodePath.join(input.directory, "hooks", "register.js");
      await NodeFSP.writeFile(path, "export function register() {}\n");
      assert.isTrue(await refreshClaudeMod({ ...input, install: false }));
      const idle = await NodeFSP.readFile(path, "utf8");
      assert.strictEqual(idle, claudeModFiles({ ...input, active: false })["hooks/register.js"]);
      assert.include(idle, "const peerActive = false;");
      await removeClaudeMod(input.directory);
      // Settings name it: it is written, active.
      assert.isTrue(await refreshClaudeMod({ ...input, install: true }));
      assert.strictEqual(
        await NodeFSP.readFile(path, "utf8"),
        claudeModFiles(input)["hooks/register.js"],
      );
      assert.include(await NodeFSP.readFile(path, "utf8"), "const peerActive = true;");
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

  it("does not replace a plugin somebody else owns", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-mod-owner-"));
    try {
      const directory = peerClaudeModPath(root);
      await NodeFSP.mkdir(NodePath.join(directory, ".claude-plugin"), { recursive: true });
      const path = NodePath.join(directory, ".claude-plugin", "plugin.json");
      await NodeFSP.writeFile(path, '{"name":"someone-else"}');
      await expect(
        writeClaudeMod({ directory, socketPath: "/tmp/broker.sock", peerScript: "/peer/bin/peer" }),
      ).rejects.toThrow("does not belong to Peer");
      await expect(removeClaudeMod(directory)).rejects.toThrow("does not belong to Peer");
      assert.strictEqual(await NodeFSP.readFile(path, "utf8"), '{"name":"someone-else"}');
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});
