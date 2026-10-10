// @effect-diagnostics nodeBuiltinImport:off - a temporary state directory and a script that echoes its arguments.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, assert, describe, it } from "@effect/vitest";

import { peerHerdrPaths } from "./binary.ts";
import {
  herdrAttachCommand,
  openHerdrTerminal,
  shellQuote,
  type TerminalHost,
} from "./terminal.ts";

const scratch: Array<string> = [];
const makeDir = () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-herdr-terminal-"));
  scratch.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of scratch.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

const BIN = "/Applications/Peer.app/Contents/Resources/herdr/herdr";

/** A computer that has `programs` (name to path), and records what it was asked to find and start. */
function fakeHost(options: {
  readonly platform: NodeJS.Platform;
  readonly programs?: Readonly<Record<string, string>>;
  readonly env?: NodeJS.ProcessEnv;
  readonly failing?: ReadonlyArray<string>;
}) {
  const asked: Array<string> = [];
  const launched: Array<readonly [string, ReadonlyArray<string>]> = [];
  const host: TerminalHost = {
    platform: options.platform,
    env: options.env ?? {},
    find: (program) => {
      asked.push(program);
      return options.programs?.[program];
    },
    launch: async (file, args) => {
      launched.push([file, args]);
      return !(options.failing ?? []).includes(file);
    },
  };
  return { host, asked, launched };
}

describe("herdrAttachCommand", () => {
  it("names the configuration file, the binary and the session", () => {
    const paths = peerHerdrPaths("/home/ana/.peer", { XDG_CONFIG_HOME: "/xdg" });
    assert.strictEqual(
      herdrAttachCommand(BIN, paths),
      `HERDR_CONFIG_PATH='/home/ana/.peer/herdr/config.toml' '${BIN}' --session '${paths.session}'`,
    );
  });

  it("quotes paths with spaces and quotes so a shell reads them back as they are", () => {
    const dir = makeDir();
    const home = NodePath.join(dir, `it's a "state" dir`);
    const bin = NodePath.join(dir, `Peer's app`, "herdr");
    NodeFS.mkdirSync(NodePath.dirname(bin), { recursive: true });
    // A binary that prints how it was called, as a shell would run herdr.
    NodeFS.writeFileSync(bin, '#!/bin/sh\nprintf \'%s\\n\' "$HERDR_CONFIG_PATH" "$@"\n', {
      mode: 0o755,
    });
    const paths = peerHerdrPaths(home, { XDG_CONFIG_HOME: "/xdg" });
    const out = NodeChildProcess.execFileSync("sh", ["-c", herdrAttachCommand(bin, paths)], {
      encoding: "utf8",
    });
    assert.deepStrictEqual(out.split("\n").slice(0, 3), [
      paths.configPath,
      "--session",
      paths.session,
    ]);
    assert.strictEqual(shellQuote(`a'b c"d$e`), `'a'\\''b c"d$e'`);
    assert.strictEqual(shellQuote(""), "''");
  });
});

describe("openHerdrTerminal on macOS", () => {
  it("writes a private script that attaches and opens it with `open`", async () => {
    const stateDir = makeDir();
    const paths = peerHerdrPaths(stateDir, { XDG_CONFIG_HOME: "/xdg" });
    const { host, launched } = fakeHost({
      platform: "darwin",
      programs: { open: "/usr/bin/open" },
    });
    assert.deepStrictEqual(await openHerdrTerminal({ bin: BIN, paths, host }), {
      opened: true,
      via: "open",
    });
    assert.deepStrictEqual(launched, [["/usr/bin/open", [paths.commandPath]]]);
    assert.strictEqual(NodeFS.statSync(paths.commandPath).mode & 0o777, 0o700);
    const script = NodeFS.readFileSync(paths.commandPath, "utf8");
    assert.match(script, /^#!\/bin\/sh\n/);
    assert.include(script, `\n${herdrAttachCommand(BIN, paths)}\n`);
  });

  it("tightens the mode of a script an earlier run left readable by others", async () => {
    const paths = peerHerdrPaths(makeDir(), { XDG_CONFIG_HOME: "/xdg" });
    NodeFS.mkdirSync(NodePath.dirname(paths.commandPath), { recursive: true });
    NodeFS.writeFileSync(paths.commandPath, "stale script", { mode: 0o755 });
    const { host } = fakeHost({ platform: "darwin", programs: { open: "/usr/bin/open" } });
    await openHerdrTerminal({ bin: BIN, paths, host });
    assert.strictEqual(NodeFS.statSync(paths.commandPath).mode & 0o777, 0o700);
    assert.notInclude(NodeFS.readFileSync(paths.commandPath, "utf8"), "stale script");
  });

  it("says no terminal when `open` is missing or fails", async () => {
    const paths = peerHerdrPaths(makeDir(), { XDG_CONFIG_HOME: "/xdg" });
    const missing = fakeHost({ platform: "darwin" });
    const failing = fakeHost({
      platform: "darwin",
      programs: { open: "/usr/bin/open" },
      failing: ["/usr/bin/open"],
    });
    for (const { host } of [missing, failing]) {
      const result = await openHerdrTerminal({ bin: BIN, paths, host });
      assert.strictEqual(result.opened, false);
    }
    assert.deepStrictEqual(missing.launched, []);
  });
});

describe("openHerdrTerminal on Linux", () => {
  const paths = peerHerdrPaths("/home/ana/.peer", { XDG_CONFIG_HOME: "/xdg" });
  const attach = herdrAttachCommand(BIN, paths);
  const everything = {
    "x-terminal-emulator": "/usr/bin/x-terminal-emulator",
    "gnome-terminal": "/usr/bin/gnome-terminal",
    konsole: "/usr/bin/konsole",
    "xfce4-terminal": "/usr/bin/xfce4-terminal",
    kitty: "/usr/bin/kitty",
    alacritty: "/usr/bin/alacritty",
    wezterm: "/usr/bin/wezterm",
    xterm: "/usr/bin/xterm",
    foot: "/usr/bin/foot",
  };

  it("tries $TERMINAL first", async () => {
    const { host, launched, asked } = fakeHost({
      platform: "linux",
      env: { TERMINAL: "foot" },
      programs: everything,
    });
    assert.deepStrictEqual(await openHerdrTerminal({ bin: BIN, paths, host }), {
      opened: true,
      via: "foot",
    });
    assert.deepStrictEqual(asked, ["foot"]);
    assert.deepStrictEqual(launched, [["/usr/bin/foot", ["-e", "sh", "-c", attach]]]);
  });

  it("goes through the usual terminals in order, each with its own way to run a command", async () => {
    const order = ["x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal"];
    const flags: Record<string, ReadonlyArray<string>> = {
      "x-terminal-emulator": ["-e"],
      "gnome-terminal": ["--"],
      konsole: ["-e"],
      "xfce4-terminal": ["-x"],
      kitty: [],
      alacritty: ["-e"],
      wezterm: ["start", "--"],
      xterm: ["-e"],
    };
    const programs: Record<string, string> = { ...everything };
    // Take the best terminal away until none is left: the next in the list is used each time.
    for (const name of [...order, "kitty", "alacritty", "wezterm", "xterm"]) {
      const { host, launched } = fakeHost({ platform: "linux", programs });
      const result = await openHerdrTerminal({ bin: BIN, paths, host });
      assert.deepStrictEqual(result, { opened: true, via: name });
      assert.deepStrictEqual(launched, [
        [`/usr/bin/${name}`, [...flags[name]!, "sh", "-c", attach]],
      ]);
      delete programs[name];
    }
  });

  it("falls through to the next terminal when one fails to start", async () => {
    const { host, launched } = fakeHost({
      platform: "linux",
      programs: everything,
      failing: ["/usr/bin/x-terminal-emulator", "/usr/bin/gnome-terminal"],
    });
    assert.deepStrictEqual(await openHerdrTerminal({ bin: BIN, paths, host }), {
      opened: true,
      via: "konsole",
    });
    assert.deepStrictEqual(
      launched.map(([file]) => file),
      ["/usr/bin/x-terminal-emulator", "/usr/bin/gnome-terminal", "/usr/bin/konsole"],
    );
  });

  it("says none when nothing exists, after looking for every one in order", async () => {
    const { host, launched, asked } = fakeHost({ platform: "linux", env: { TERMINAL: "foot" } });
    const result = await openHerdrTerminal({ bin: BIN, paths, host });
    assert.strictEqual(result.opened, false);
    assert.match(result.opened ? "" : result.reason, /no terminal application/);
    assert.deepStrictEqual(asked, [
      "foot",
      "x-terminal-emulator",
      "gnome-terminal",
      "konsole",
      "xfce4-terminal",
      "kitty",
      "alacritty",
      "wezterm",
      "xterm",
    ]);
    assert.deepStrictEqual(launched, []);
  });
});

describe("openHerdrTerminal elsewhere", () => {
  it("opens nothing on Windows", async () => {
    const { host, launched, asked } = fakeHost({ platform: "win32", programs: { xterm: "xterm" } });
    const result = await openHerdrTerminal({
      bin: BIN,
      paths: peerHerdrPaths("/home/ana/.peer", { XDG_CONFIG_HOME: "/xdg" }),
      host,
    });
    assert.strictEqual(result.opened, false);
    assert.deepStrictEqual([asked, launched], [[], []]);
  });
});
