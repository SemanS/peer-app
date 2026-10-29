// @effect-diagnostics nodeBuiltinImport:off - executes generated scripts against a synthetic Unix broker.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import {
  claudeHookGroups,
  codexHookGroups,
  codexHookHash,
  codexHookTrust,
  codexRules,
  codexTrustsPeerHooks,
  coordinationScripts,
  hasPeerHooks,
  settingsDiffer,
  withContextAccess,
  withPeerHooks,
} from "./scripts.ts";

async function command(script: string, args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    NodeChildProcess.execFile(
      "/bin/sh",
      ["-c", script, "peer", ...args],
      (error, stdout, stderr) => {
        resolve({
          code: error === null ? 0 : typeof error.code === "number" ? error.code : 1,
          stdout,
          stderr,
        });
      },
    );
  });
}

async function broker(status: number, body: string, run: (script: string) => Promise<void>) {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-transport-"));
  const socket = NodePath.join(dir, "broker.sock");
  const server = NodeHttp.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(status);
      response.end(body);
    });
  });
  try {
    await new Promise<void>((resolve) => server.listen(socket, resolve));
    await run(coordinationScripts(socket, NodePath.join(dir, "bin")).peer);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await NodeFSP.rm(dir, { force: true, recursive: true });
  }
}

describe("generated Peer CLI transport", () => {
  it("exits nonzero and displays the broker's useful 409 body", async () => {
    await broker(
      409,
      "peer: this agent session is not registered. Start a fresh session.\n",
      async (script) => {
        const result = await command(script, ["note", "hello"]);
        assert.notStrictEqual(result.code, 0);
        assert.include(result.stderr, "this agent session is not registered");
        assert.strictEqual(result.stdout, "");
      },
    );
  });

  it("preserves successful output and exit status", async () => {
    await broker(200, "Note sent.\n", async (script) => {
      const result = await command(script, ["note", "hello"]);
      assert.strictEqual(result.code, 0);
      assert.strictEqual(result.stdout, "Note sent.\n");
      assert.strictEqual(result.stderr, "");
    });
  });

  it("keeps the network failure message when Peer is not running", async () => {
    const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-transport-"));
    try {
      const result = await command(
        coordinationScripts(NodePath.join(dir, "absent.sock"), dir).peer,
        [],
      );
      assert.notStrictEqual(result.code, 0);
      assert.include(result.stderr, "Peer is not running");
    } finally {
      await NodeFSP.rm(dir, { force: true, recursive: true });
    }
  });
});

describe("the project's other work", () => {
  it("lets Peer's own runs of an agent through without coordinating them", () => {
    const scripts = coordinationScripts("/s/peer.sock", "/s/bin");
    assert.include(scripts.hook, `[ "\${PEER_COORDINATION:-}" = off ] && exit 0`);
    assert.include(
      scripts.wait,
      `[ "\${PEER_COORDINATION:-}" = off ] && { cat >/dev/null; exit 0; }`,
    );
  });
});

describe("Claude Code settings", () => {
  const groups = claudeHookGroups({ hook: "/peer/coord/hook", wait: "/peer/coord/wait" });
  const theirs = {
    model: "opus",
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/other/guard.sh" }] }],
    },
  };

  it("adds Peer's hooks beside others' and takes only its own out again", () => {
    const installed = withPeerHooks(theirs, groups, "/peer/coord", true);
    assert.isTrue(hasPeerHooks(installed, "/peer/coord"));
    assert.strictEqual(installed.model, "opus");
    assert.strictEqual(installed.hooks?.PreToolUse?.length, 2);
    const twice = withPeerHooks(installed, groups, "/peer/coord", true);
    assert.strictEqual(twice.hooks?.PreToolUse?.length, 2, "installing again does not duplicate");
    const removed = withPeerHooks(twice, groups, "/peer/coord", false);
    assert.deepStrictEqual(removed, theirs);
  });

  it("hears a step that ended in an error as it hears one that finished", () => {
    // Claude Code sends PostToolUseFailure, never PostToolUse, after a command that exits non-zero.
    assert.strictEqual(
      groups.PostToolUse?.[0]?.matcher,
      `${String(groups.PostToolUseFailure?.[0]?.matcher)}|mcp__kontext__ctx_capture`,
    );
    assert.deepStrictEqual(groups.PostToolUseFailure?.[0]?.hooks, groups.PostToolUse?.[0]?.hooks);
    const installed = withPeerHooks(theirs, groups, "/peer/coord", true);
    assert.strictEqual(
      installed.hooks?.PostToolUseFailure?.[0]?.hooks?.[0]?.command,
      "/peer/coord/hook",
    );
    assert.deepStrictEqual(withPeerHooks(installed, groups, "/peer/coord", false), theirs);
  });

  it("preserves foreign commands that merely mention Peer's script directory", () => {
    const foreign = {
      hooks: { Stop: [{ hooks: [{ command: "echo /peer/coord/hook && notify" }] }] },
    };
    assert.isFalse(hasPeerHooks(foreign, "/peer/coord"));
    assert.deepStrictEqual(withPeerHooks(foreign, groups, "/peer/coord", false), foreign);
  });

  it("changes Peer's hooks where they are, so hooks after them keep their place", () => {
    // Codex trusts each hook by its position: a hook another tool added after Peer's stays trusted.
    const theirsAfter = { hooks: [{ type: "command", command: "/other/notify.sh" }] };
    const settings = {
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: "/first/notify.sh" }] },
          { hooks: [{ type: "command", command: "/peer/coord/hook" }] },
          theirsAfter,
        ],
      },
    };
    const upgraded = withPeerHooks(settings, groups, "/peer/coord", true);
    assert.strictEqual(upgraded.hooks?.Stop?.[0]?.hooks?.[0]?.command, "/first/notify.sh");
    assert.deepStrictEqual(upgraded.hooks?.Stop?.[1], groups.Stop?.[0]);
    assert.strictEqual(upgraded.hooks?.Stop?.[2], theirsAfter);
    assert.strictEqual(upgraded.hooks?.Stop?.length, 3);
  });

  it("upgrades hooks an older Peer installed once, then leaves the settings alone", () => {
    const older = withPeerHooks(
      theirs,
      {
        PostToolUse: [
          { matcher: "Edit|Write", hooks: [{ type: "command", command: "/peer/coord/hook" }] },
        ],
      },
      "/peer/coord",
      true,
    );
    const upgraded = withPeerHooks(older, groups, "/peer/coord", true);
    assert.isTrue(settingsDiffer(upgraded, older));
    assert.strictEqual(upgraded.hooks?.PostToolUse?.[0]?.matcher, groups.PostToolUse?.[0]?.matcher);
    assert.isDefined(upgraded.hooks?.Notification);
    assert.strictEqual(upgraded.model, "opus");
    assert.isFalse(settingsDiffer(withPeerHooks(upgraded, groups, "/peer/coord", true), upgraded));
  });

  it("hears kontext's capture after it, and no other MCP tool", () => {
    const matcher = new RegExp(`^(?:${String(groups.PostToolUse?.[0]?.matcher)})$`);
    assert.isTrue(matcher.test("mcp__kontext__ctx_capture"));
    assert.isTrue(matcher.test("Bash"));
    assert.isFalse(matcher.test("mcp__kontext__ctx_search"));
    assert.isFalse(matcher.test("mcp__other__ctx_capture"));
    // A settings file from before it is rewritten once, as any change of Peer's hooks is.
    const before = withPeerHooks(
      theirs,
      {
        ...groups,
        PostToolUse: [
          { ...groups.PostToolUse![0]!, matcher: groups.PostToolUseFailure![0]!.matcher },
        ],
      },
      "/peer/coord",
      true,
    );
    const upgraded = withPeerHooks(before, groups, "/peer/coord", true);
    assert.isTrue(settingsDiffer(upgraded, before));
    assert.strictEqual(upgraded.hooks?.PostToolUse?.[0]?.matcher, groups.PostToolUse?.[0]?.matcher);
  });
});

describe("Codex", () => {
  const groups = codexHookGroups({ hook: "/peer/coord/hook", wait: "/peer/coord/wait" });

  it("hooks Codex's shell and patches, and tells Peer the hook is Codex's", () => {
    assert.strictEqual(groups.PreToolUse?.[0]?.matcher, "Bash|apply_patch");
    assert.strictEqual(groups.PostToolUse?.[0]?.matcher, "Bash|apply_patch");
    assert.strictEqual(groups.Stop?.[0]?.hooks?.[0]?.command, "/peer/coord/hook codex");
    // Codex has no Notification: PermissionRequest says an agent waits for its person.
    assert.isDefined(groups.PermissionRequest);
    assert.isUndefined(groups.Notification);
    // Nor a failure event: its PostToolUse follows a command that exits non-zero too.
    assert.isUndefined(groups.PostToolUseFailure);
    assert.strictEqual(groups.Interrupt?.[0]?.hooks?.[0]?.timeout, 3);
    assert.strictEqual(groups.SessionEnd?.[0]?.hooks?.[0]?.timeout, 3);
  });

  it.each([
    ["SessionEnd", "2.5"],
    ["Interrupt", "2.5"],
    ["PreToolUse", "4"],
  ])("bounds the %s transport below Codex's hook timeout", async (event, expected) => {
    const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-hook-timeout-"));
    try {
      await NodeFSP.writeFile(
        NodePath.join(dir, "curl"),
        '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do\nif [ "$1" = --max-time ]; then shift; printf "%s" "$1"; exit 0; fi\nshift\ndone\n',
        { mode: 0o700 },
      );
      const result = await new Promise<string>((resolve, reject) => {
        const child = NodeChildProcess.execFile(
          "/bin/sh",
          ["-c", coordinationScripts("/unused.sock", dir).hook, "peer", "codex"],
          { env: { PATH: `${dir}:/usr/bin:/bin` } },
          (error, stdout) => (error === null ? resolve(stdout) : reject(error)),
        );
        child.stdin?.end(JSON.stringify({ hook_event_name: event }));
      });
      assert.strictEqual(result, expected);
    } finally {
      await NodeFSP.rm(dir, { recursive: true, force: true });
    }
  });

  it("hashes a hook as Codex does to trust it", () => {
    const hook = { type: "command", command: "/peer/coord/hook codex", timeout: 5 };
    assert.strictEqual(
      codexHookHash("PostToolUse", "Bash|apply_patch", hook),
      "sha256:9abcefe6c7d8028cceba041603ab9138deeb747ffc42e81add18b61689212704",
    );
    // Stop has no matcher; SessionEnd's timeout is one to three seconds.
    assert.strictEqual(
      codexHookHash("Stop", undefined, hook),
      "sha256:8551bd6b73da83754c962155e84fd26d74c9f4e8075d5a1be971aab0e4070905",
    );
    assert.strictEqual(
      codexHookHash("SessionEnd", undefined, { ...hook, timeout: 2 }),
      "sha256:b82c3d1b270a058482e21fc2d7d37ed2d0bee37f1d59bbb3695020b41140f07e",
    );
    assert.isNull(codexHookHash("Notification", undefined, hook));
  });

  it("reads which hooks Codex trusts, and says whether it runs Peer's", () => {
    const path = "/u/.codex/hooks.json";
    const hooks = withPeerHooks(
      { hooks: { Stop: [{ hooks: [{ type: "command", command: "/other/notify.sh" }] }] } },
      { Stop: groups.Stop ?? [] },
      "/peer/coord",
      true,
    );
    const hash =
      codexHookHash("Stop", undefined, {
        type: "command",
        command: "/peer/coord/hook codex",
        timeout: 5,
      }) ?? "";
    const config = [
      'model = "gpt-5"',
      "[hooks.state]",
      "",
      `[hooks.state."${path}:stop:0:0"]`,
      'trusted_hash = "sha256:theirs"',
      "",
      `[hooks.state."${path}:stop:1:0"]`,
      `trusted_hash = "${hash}"`,
      "",
      "[features]",
      "hooks = true",
    ].join("\n");
    assert.deepStrictEqual(codexHookTrust(config).get(`${path}:stop:1:0`), {
      hash,
      contentHash: undefined,
      enabled: true,
    });
    assert.isTrue(codexTrustsPeerHooks(hooks, path, config, "/peer/coord"));
    assert.isFalse(codexTrustsPeerHooks(hooks, path, 'model = "gpt-5"\n', "/peer/coord"));
    const off = config.replace(
      `trusted_hash = "${hash}"`,
      `trusted_hash = "${hash}"\nenabled = false`,
    );
    assert.isFalse(codexTrustsPeerHooks(hooks, path, off, "/peer/coord"));
    // A changed hook is not the one its person trusted.
    const changed = withPeerHooks(
      hooks,
      { Stop: [{ hooks: [{ type: "command", command: "/peer/coord/hook codex", timeout: 9 }] }] },
      "/peer/coord",
      true,
    );
    assert.isFalse(codexTrustsPeerHooks(changed, path, config, "/peer/coord"));
  });

  it("lets only Peer's own command past Codex's sandbox", () => {
    assert.strictEqual(
      codexRules("/peer/coord/bin/peer"),
      '# Peer coordination: Peer\'s own command talks to Peer on this computer. Peer adds and removes this file.\nprefix_rule(pattern=["/peer/coord/bin/peer"], decision="allow")\n',
    );
  });
});

describe("working context", () => {
  it("lets agents read and edit only Peer's contexts folder, and takes the rule back out", () => {
    const theirs = {
      permissions: { allow: ["Bash(npm test)"], deny: ["Read(./.env)"] },
      model: "opus",
    };
    const given = withContextAccess(theirs, "/Users/ana/.peer/userdata/coord/contexts", true);
    assert.deepStrictEqual((given.permissions as { allow: string[] }).allow, [
      "Bash(npm test)",
      "Read(//Users/ana/.peer/userdata/coord/contexts/**)",
      "Edit(//Users/ana/.peer/userdata/coord/contexts/**)",
    ]);
    const twice = withContextAccess(given, "/Users/ana/.peer/userdata/coord/contexts", true);
    assert.deepStrictEqual(twice, given, "installing again changes nothing");
    assert.deepStrictEqual(
      withContextAccess(twice, "/Users/ana/.peer/userdata/coord/contexts", false),
      theirs,
    );
  });
});
