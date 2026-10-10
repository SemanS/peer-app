/**
 * A computer as the herdr plugin sees it through `HerdrProcess`: the person's herdr, Peer's, the
 * bundled binary, the terminal windows and integrations, all in memory. Tests that start the
 * plugin give it in place of the real process, so none looks for a herdr socket on the machine.
 *
 * @module peerHub/plugins/herdr/client/HerdrProcess.testkit
 */
import type { PeerHerdrIntegration } from "@t3tools/contracts";

import { peerHerdrPaths, type HerdrBinary } from "./binary.ts";
import type { HerdrAgent } from "./herdr.ts";
import type { HerdrProcessShape } from "./HerdrProcess.ts";
import type { OpenTerminalResult } from "./terminal.ts";

export const FAKE_OWN_SOCKET = "/home/ana/.config/herdr/herdr.sock";
export const FAKE_BIN = "/Applications/Peer.app/Contents/Resources/herdr/herdr";

interface FakeHerdr {
  version: string;
  agents: Array<HerdrAgent>;
}

/** What the fake computer holds; tests change it between steps. */
export interface FakeHerdrWorld {
  binary: HerdrBinary;
  bundledVersion: string;
  /** The person's own herdr, when it runs. */
  own: FakeHerdr | null;
  /** Peer's herdr, when it runs. */
  peer: FakeHerdr | null;
  /** What a start of Peer's herdr does. */
  startFails: boolean;
  attached: number | "unknown";
  terminal: OpenTerminalResult;
  integrations: Array<PeerHerdrIntegration>;
  /** Everything Peer asked of herdr's process, in order. */
  calls: Array<string>;
}

export function fakeHerdrWorld(initial: Partial<FakeHerdrWorld> = {}): FakeHerdrWorld {
  return {
    binary: { available: true, path: FAKE_BIN },
    bundledVersion: "0.9.3",
    own: null,
    peer: null,
    startFails: false,
    attached: "unknown",
    terminal: { opened: true, via: "open" },
    integrations: [
      { agent: "claude", state: "missing", files: ["/home/ana/.claude/settings.json"] },
      { agent: "codex", state: "missing", files: ["/home/ana/.codex/hooks.json"] },
    ],
    calls: [],
    ...initial,
  };
}

export function fakeHerdrProcess(world: FakeHerdrWorld): HerdrProcessShape {
  let peerSocket = "";
  const herdrAt = (socket: string) => (socket === peerSocket ? world.peer : world.own);
  return {
    binary: () => world.binary,
    paths: (stateDir) => {
      const paths = peerHerdrPaths(stateDir, { XDG_CONFIG_HOME: "/home/ana/.config" });
      peerSocket = paths.socketPath;
      return paths;
    },
    ownSocketPath: () => FAKE_OWN_SOCKET,
    binaryVersion: async () => world.bundledVersion,
    ping: async (socket) => {
      const herdr = herdrAt(socket);
      return herdr === null ? null : { version: herdr.version, protocol: 22, capabilities: [] };
    },
    agents: async (socket) => herdrAt(socket)?.agents ?? null,
    start: async () => {
      world.calls.push("start");
      if (world.startFails)
        return { ok: false, reasonClass: "exited", reason: "herdr exited.", spawned: undefined };
      world.peer = { version: world.bundledVersion, agents: [] };
      return { ok: true, version: world.bundledVersion, adopted: false, spawned: undefined };
    },
    stop: async () => {
      world.calls.push("stop");
      world.peer = null;
      return { stopped: true };
    },
    attachedClients: async () => world.attached,
    attachCommand: (home) => `herdr --session ${home.paths.session}`,
    openTerminal: async () => {
      world.calls.push("open terminal");
      if (world.terminal.opened && world.attached !== "unknown") world.attached += 1;
      return world.terminal;
    },
    integrations: async () => world.integrations,
    setIntegration: async (_home, agent, installed) => {
      world.calls.push(`${installed ? "install" : "uninstall"} ${agent}`);
      world.integrations = world.integrations.map((one) =>
        one.agent === agent ? { ...one, state: installed ? "installed" : "missing" } : one,
      );
      return { ok: true, messages: [] };
    },
  };
}
