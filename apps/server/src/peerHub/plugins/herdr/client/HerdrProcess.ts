/**
 * herdr as a process Peer runs: its binary, its server, its terminal window and its integrations.
 * The supervisor works through this seam, and tests put a stand-in in its place, so none starts a
 * real herdr. `HerdrClient` is the other seam, for talking to a herdr that runs.
 *
 * @module peerHub/plugins/herdr/client/HerdrProcess
 */
import * as Context from "effect/Context";
import type { PeerHerdrIntegration, PeerHerdrIntegrationAgent } from "@t3tools/contracts";

import {
  herdrServerEnv,
  peerHerdrPaths,
  resolveHerdrBinary,
  writeHerdrConfig,
  type HerdrBinary,
  type PeerHerdrPaths,
} from "./binary.ts";
import {
  herdrSocketPath,
  listHerdrAgents,
  pingHerdr,
  type HerdrAgent,
  type HerdrPing,
} from "./herdr.ts";
import {
  herdrIntegrationStatuses,
  setHerdrIntegration,
  type HerdrIntegrationChange,
} from "./integration.ts";
import {
  readHerdrAttachedClients,
  readHerdrBinaryVersion,
  startHerdrServer,
  stopHerdrServer,
  type HerdrSpawned,
  type HerdrStartResult,
  type HerdrStopResult,
} from "./server.ts";
import { herdrAttachCommand, openHerdrTerminal, type OpenTerminalResult } from "./terminal.ts";

/** Peer's herdr on this computer: the binary it runs and the places it keeps things. */
export interface HerdrHome {
  readonly bin: string;
  readonly paths: PeerHerdrPaths;
}

export interface HerdrProcessShape {
  /** The bundled binary, or why there is none; read when asked, from the environment. */
  readonly binary: () => HerdrBinary;
  /** The session, socket and files of the herdr of the Peer whose state lives in `stateDir`. */
  readonly paths: (stateDir: string) => PeerHerdrPaths;
  /** Where the person's own herdr listens (`herdrSocketPath`). */
  readonly ownSocketPath: () => string;
  /** The version the binary says it is. */
  readonly binaryVersion: (bin: string, paths: PeerHerdrPaths) => Promise<string | undefined>;
  readonly ping: (socketPath: string) => Promise<HerdrPing | null>;
  /** The agents the herdr at `socketPath` runs, or null when it cannot say. */
  readonly agents: (socketPath: string) => Promise<ReadonlyArray<HerdrAgent> | null>;
  /** Writes the managed configuration and starts the server; resolves once it answers or fails. */
  readonly start: (home: HerdrHome) => Promise<HerdrStartResult>;
  /** Stops the server; `spawned` is the process this Peer started, if it still does. */
  readonly stop: (home: HerdrHome, spawned?: HerdrSpawned) => Promise<HerdrStopResult>;
  /** How many terminal clients are attached, or "unknown" when herdr does not say. */
  readonly attachedClients: (home: HerdrHome) => Promise<number | "unknown">;
  readonly attachCommand: (home: HerdrHome) => string;
  readonly openTerminal: (home: HerdrHome) => Promise<OpenTerminalResult>;
  readonly integrations: (home: HerdrHome) => Promise<ReadonlyArray<PeerHerdrIntegration>>;
  readonly setIntegration: (
    home: HerdrHome,
    agent: PeerHerdrIntegrationAgent,
    installed: boolean,
  ) => Promise<HerdrIntegrationChange>;
}

/** The cleaned environment herdr and its installer run with. */
const environment = (home: HerdrHome) =>
  herdrServerEnv(process.env, { configPath: home.paths.configPath });

export const realHerdrProcess: HerdrProcessShape = {
  binary: () => resolveHerdrBinary(),
  paths: (stateDir) => peerHerdrPaths(stateDir),
  ownSocketPath: () => herdrSocketPath(),
  binaryVersion: (bin, paths) =>
    readHerdrBinaryVersion({
      bin,
      env: herdrServerEnv(process.env, { configPath: paths.configPath }),
    }),
  ping: (socketPath) => pingHerdr(socketPath),
  agents: (socketPath) => listHerdrAgents(socketPath),
  start: (home) => {
    writeHerdrConfig(home.paths);
    return startHerdrServer({ ...home, env: environment(home) });
  },
  stop: (home, spawned) => stopHerdrServer({ ...home, env: environment(home), spawned }),
  attachedClients: (home) => readHerdrAttachedClients({ ...home, env: environment(home) }),
  attachCommand: (home) => herdrAttachCommand(home.bin, home.paths),
  openTerminal: (home) => openHerdrTerminal(home),
  integrations: (home) => herdrIntegrationStatuses({ bin: home.bin, env: environment(home) }),
  setIntegration: (home, agent, installed) =>
    setHerdrIntegration(agent, installed, { bin: home.bin, env: environment(home) }),
};

/** herdr's process on this computer, the real one unless a test gives another. */
export class HerdrProcess extends Context.Reference<HerdrProcessShape>(
  "t3/peerHub/plugins/herdr/client/HerdrProcess",
  { defaultValue: () => realHerdrProcess },
) {}
