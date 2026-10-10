// @effect-diagnostics nodeBuiltinImport:off - executable and configuration fixtures in a temporary directory.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, assert, describe, it } from "@effect/vitest";

import {
  compareHerdrVersions,
  HERDR_MANAGED_CONFIG,
  herdrServerEnv,
  peerHerdrPaths,
  peerHerdrSession,
  resolveHerdrBinary,
  writeHerdrConfig,
} from "./binary.ts";

const scratch: Array<string> = [];
const makeDir = () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-herdr-binary-"));
  scratch.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of scratch.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

const binaryAt = (dir: string, mode: number) => {
  const path = NodePath.join(dir, "herdr");
  NodeFS.writeFileSync(path, "#!/bin/sh\n", { mode });
  NodeFS.chmodSync(path, mode);
  return path;
};

describe("resolveHerdrBinary", () => {
  it("accepts an executable file on macOS and Linux", () => {
    const path = binaryAt(makeDir(), 0o755);
    for (const platform of ["darwin", "linux"] as const)
      assert.deepStrictEqual(resolveHerdrBinary({ env: { PEER_HERDR_BIN: path }, platform }), {
        available: true,
        path,
      });
  });

  it("is unavailable, with a reason, when nothing is bundled", () => {
    const result = resolveHerdrBinary({ env: {}, platform: "darwin" });
    assert.strictEqual(result.available, false);
    assert.match(result.available ? "" : result.reason, /does not include herdr/);
  });

  it("is unavailable when the file is missing, a directory or not executable", () => {
    const dir = makeDir();
    for (const path of [
      NodePath.join(dir, "missing"),
      dir,
      binaryAt(makeDir(), 0o644),
      binaryAt(makeDir(), 0o600),
    ]) {
      const result = resolveHerdrBinary({ env: { PEER_HERDR_BIN: path }, platform: "linux" });
      assert.strictEqual(result.available, false, path);
      assert.match(result.available ? "" : result.reason, /missing or cannot be run/);
      assert.notInclude(result.available ? "" : result.reason, path);
    }
  });

  it("is unavailable on Windows even for an executable file", () => {
    const path = binaryAt(makeDir(), 0o755);
    const result = resolveHerdrBinary({ env: { PEER_HERDR_BIN: path }, platform: "win32" });
    assert.strictEqual(result.available, false);
    assert.match(result.available ? "" : result.reason, /operating system/);
  });
});

describe("peerHerdrPaths", () => {
  it("gives each Peer home a session and a socket of its own", () => {
    const env = { XDG_CONFIG_HOME: "/xdg" };
    const one = peerHerdrPaths("/home/ana/.peer", env);
    const two = peerHerdrPaths("/work/tree/.t3", env);
    assert.match(one.session, /^peer-[0-9a-f]{8}$/);
    assert.notStrictEqual(one.session, two.session);
    assert.notStrictEqual(one.socketPath, two.socketPath);
    assert.strictEqual(one.session, peerHerdrSession("/home/ana/.peer"));
    assert.strictEqual(one.session, peerHerdrPaths("/home/ana/.peer", env).session);
  });

  it("puts the socket in the session directory under XDG_CONFIG_HOME", () => {
    const paths = peerHerdrPaths("/home/ana/.peer", { XDG_CONFIG_HOME: "/xdg" });
    assert.strictEqual(paths.sessionDir, NodePath.join("/xdg/herdr/sessions", paths.session));
    assert.strictEqual(paths.socketPath, NodePath.join(paths.sessionDir, "herdr.sock"));
    assert.strictEqual(paths.logPath, NodePath.join(paths.sessionDir, "herdr-server.log"));
    assert.strictEqual(paths.configPath, "/home/ana/.peer/herdr/config.toml");
    assert.strictEqual(paths.commandPath, "/home/ana/.peer/herdr/open-herdr.command");
  });

  it("falls back to ~/.config and ignores the person's own socket variables", () => {
    const paths = peerHerdrPaths("/home/ana/.peer", {
      HERDR_SOCKET_PATH: "/elsewhere/herdr.sock",
      HERDR_SESSION: "mine",
    });
    assert.strictEqual(
      paths.socketPath,
      NodePath.join(NodeOS.homedir(), ".config/herdr/sessions", paths.session, "herdr.sock"),
    );
  });
});

describe("writeHerdrConfig", () => {
  it("writes the managed file over whatever was there, private to the owner", () => {
    const stateDir = makeDir();
    const paths = peerHerdrPaths(stateDir, { XDG_CONFIG_HOME: NodePath.join(stateDir, "xdg") });
    NodeFS.mkdirSync(NodePath.dirname(paths.configPath), { recursive: true });
    NodeFS.writeFileSync(paths.configPath, "[update]\nversion_check = true\n");
    writeHerdrConfig(paths);
    const text = NodeFS.readFileSync(paths.configPath, "utf8");
    assert.strictEqual(text, HERDR_MANAGED_CONFIG);
    assert.match(text, /^# Managed by Peer/);
    assert.match(text, /\[update\]\nversion_check = false\n/);
    assert.notInclude(text, "manifest_check");
    assert.strictEqual(NodeFS.statSync(paths.configPath).mode & 0o777, 0o600);
  });
});

describe("herdrServerEnv", () => {
  const person = {
    PATH: "/usr/bin:/bin",
    HOME: "/home/ana",
    GIT_AUTHOR_NAME: "Ana",
    GIT_CONFIG_GLOBAL: "/home/ana/.gitconfig",
    SSH_AUTH_SOCK: "/tmp/agent",
    ELECTRON_RUN_AS_NODE: "1",
    ELECTRON_NO_ATTACH_CONSOLE: "1",
    T3CODE_HOME: "/home/ana/.peer",
    T3CODE_PORT: "3773",
    VITE_HTTP_URL: "http://localhost",
    NODE_OPTIONS: "--max-old-space-size=512",
    PEER_HERDR_BIN: "/Applications/Peer.app/herdr",
    PEER_TASK: "t-1",
    HERDR_SOCKET_PATH: "/other/herdr.sock",
    HERDR_SESSION: "other",
    HERDR_CLIENT_SOCKET_PATH: "/other/herdr-client.sock",
    HERDR_ENV: "1",
    HERDR_PANE_ID: "w1:p1",
    HERDR_CONFIG_PATH: "/home/ana/.config/herdr/config.toml",
  };

  it("keeps the person's environment and drops Peer's and the pane pointers", () => {
    const env = herdrServerEnv(person, {
      configPath: "/state/herdr/config.toml",
      platform: "linux",
    });
    assert.deepStrictEqual(env, {
      PATH: "/usr/bin:/bin",
      HOME: "/home/ana",
      GIT_AUTHOR_NAME: "Ana",
      GIT_CONFIG_GLOBAL: "/home/ana/.gitconfig",
      SSH_AUTH_SOCK: "/tmp/agent",
      HERDR_CONFIG_PATH: "/state/herdr/config.toml",
    });
  });

  it("marks the server as started in the user's context on macOS only", () => {
    const options = { configPath: "/state/herdr/config.toml" };
    assert.strictEqual(
      herdrServerEnv(person, { ...options, platform: "darwin" }).HERDR_MACOS_SERVER_CONTEXT,
      "user",
    );
    assert.notProperty(
      herdrServerEnv(person, { ...options, platform: "linux" }),
      "HERDR_MACOS_SERVER_CONTEXT",
    );
  });

  it("leaves undefined values out and the input untouched", () => {
    const input = { PATH: "/bin", GONE: undefined, ELECTRON_RUN_AS_NODE: "1" };
    const env = herdrServerEnv(input, { configPath: "/c.toml", platform: "linux" });
    assert.deepStrictEqual(Object.keys(env).toSorted(), ["HERDR_CONFIG_PATH", "PATH"]);
    assert.strictEqual(input.ELECTRON_RUN_AS_NODE, "1");
  });
});

describe("compareHerdrVersions", () => {
  it("orders versions numerically, not as text", () => {
    assert.isBelow(compareHerdrVersions("0.9.3", "0.10.0") ?? 0, 0);
    assert.isAbove(compareHerdrVersions("0.10.0", "0.9.3") ?? 0, 0);
    assert.isBelow(compareHerdrVersions("0.9.3", "0.9.10") ?? 0, 0);
    assert.isAbove(compareHerdrVersions("1.0.0", "0.99.99") ?? 0, 0);
    assert.strictEqual(compareHerdrVersions("0.9.3", "v0.9.3"), 0);
  });

  it("puts a prerelease before its release, and answers null for what is not a version", () => {
    assert.isBelow(compareHerdrVersions("0.9.4-rc.1", "0.9.4") ?? 0, 0);
    assert.isAbove(compareHerdrVersions("0.9.4", "0.9.4-rc.1") ?? 0, 0);
    assert.isAbove(compareHerdrVersions("0.9.4", "0.9.3-rc.1") ?? 0, 0);
    assert.strictEqual(compareHerdrVersions("dev", "0.9.3"), null);
    assert.strictEqual(compareHerdrVersions("0.9.3", ""), null);
  });
});
