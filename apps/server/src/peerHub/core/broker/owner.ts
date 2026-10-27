// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off globalTimers:off globalDate:off - the owner record beside the broker's socket, and probing that socket.
/**
 * Who binds the coordination socket on this computer: the Peer app or Peer Core (`t3 peer-core`).
 * One broker per environment runs at a time; `<stateDir>/coord/owner.json` records which, and the
 * socket answering `GET /owner` says it is alive. The app takes over from Peer Core by asking it to
 * stop (`POST /owner/handover`); Peer Core never takes over from anyone.
 *
 * @module peerHub/core/broker/owner
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Context from "effect/Context";

import { socketPathFits } from "./server.ts";

export type PeerBrokerKindValue = "app" | "peer-core";

/** Which runtime this broker belongs to: the app's server, or the headless Peer Core. */
export class PeerBrokerKind extends Context.Reference<PeerBrokerKindValue>(
  "t3/peerHub/core/broker/owner/PeerBrokerKind",
  { defaultValue: () => "app" as PeerBrokerKindValue },
) {}

export interface Owner {
  readonly kind: PeerBrokerKindValue;
  readonly pid: number;
  readonly startedAt: string;
}

/** The owner record's file, beside Peer's scripts. */
export const ownerFile = (stateDir: string) => NodePath.join(stateDir, "coord", "owner.json");

/** The broker's socket for a state dir (as `PeerCoordination` places it). */
export function coordSocketPath(stateDir: string): string {
  const preferred = NodePath.join(stateDir, "coord.sock");
  return socketPathFits(preferred)
    ? preferred
    : NodePath.join(
        NodeOS.tmpdir(),
        `peer-coord-${NodeCrypto.createHash("sha256").update(stateDir).digest("hex").slice(0, 12)}.sock`,
      );
}

const isOwner = (value: unknown): value is Owner => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.kind === "app" || record.kind === "peer-core") &&
    typeof record.pid === "number" &&
    typeof record.startedAt === "string"
  );
};

function request(
  socketPath: string,
  method: "GET" | "POST",
  path: string,
  timeoutMs: number,
): Promise<{ readonly status: number; readonly body: string } | null> {
  return new Promise((resolve) => {
    const req = NodeHttp.request(
      { socketPath, method, path, host: "peer", timeout: timeoutMs },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
        response.on("error", () => resolve(null));
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
    req.end();
  });
}

const parseOwner = (body: string): Owner | null => {
  try {
    const value: unknown = JSON.parse(body);
    return isOwner(value) ? value : null;
  } catch {
    return null;
  }
};

/**
 * The live broker of a state dir, or null when nothing answers on its socket. A broker that answers
 * without the `/owner` route (a build from before the record) counts as the app's.
 */
export async function readOwner(stateDir: string): Promise<Owner | null> {
  return readOwnerAt(ownerFile(stateDir), coordSocketPath(stateDir));
}

export async function readOwnerAt(file: string, socketPath: string): Promise<Owner | null> {
  const answer = await request(socketPath, "GET", "/owner", 2000);
  if (answer === null) return null;
  const live = answer.status === 200 ? parseOwner(answer.body) : null;
  return live ?? (await readRecord(file)) ?? { kind: "app", pid: 0, startedAt: "" };
}

async function readRecord(file: string): Promise<Owner | null> {
  const text = await NodeFSP.readFile(file, "utf8").catch(() => null);
  return text === null ? null : parseOwner(text);
}

/** Asks the broker on `socketPath` to stop and hand over; true when it acknowledged. */
export async function requestHandover(socketPath: string): Promise<boolean> {
  const answer = await request(socketPath, "POST", "/owner/handover", 5000);
  return answer !== null && answer.status >= 200 && answer.status < 300;
}

/** Writes the owner record (temporary file, then rename). */
export async function writeOwner(file: string, owner: Owner): Promise<void> {
  await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await NodeFSP.writeFile(temporary, `${JSON.stringify(owner)}\n`, { mode: 0o600 });
  await NodeFSP.rename(temporary, file);
}

/** Removes the owner record when it is still `pid`'s: a broker that took over keeps its own. */
export async function removeOwner(file: string, pid: number = process.pid): Promise<void> {
  const recorded = await readRecord(file);
  if (recorded !== null && recorded.pid !== pid) return;
  await NodeFSP.rm(file, { force: true });
}

const exists = (path: string) =>
  NodeFSP.stat(path).then(
    () => true,
    () => false,
  );

/** Waits until nothing is at `socketPath`, at most `ms`; true when it went. */
export async function waitForSocketGone(socketPath: string, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (await exists(socketPath)) {
    if (Date.now() >= until) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

/**
 * How the `peer` shim starts Peer Core with this very build: node and the server's entry
 * (`bin.mjs`, or `bin.ts` in development; the desktop app's runner too, as Node), the executable
 * itself for a single-file build, else null (no autostart).
 */
export function coreLaunchCommand(stateDir?: string): ReadonlyArray<string> | null {
  const base = coreLaunchBase();
  if (base === null || stateDir === undefined) return base;
  // Peer Core reads its state dir from T3CODE_HOME: a dev state dir (`<home>/dev`) has no such flag, so
  // its shim does not autostart, and the default home needs no variable.
  if (NodePath.basename(stateDir) !== "userdata") return null;
  const home = NodePath.resolve(NodePath.dirname(stateDir));
  if (home === NodePath.resolve(NodeOS.homedir(), ".peer")) return base;
  const variable = `T3CODE_HOME=${home}`;
  return base[0] === "/usr/bin/env"
    ? [base[0], variable, ...base.slice(1)]
    : ["/usr/bin/env", variable, ...base];
}

function coreLaunchBase(): ReadonlyArray<string> | null {
  const entry = process.argv[1];
  const electron = process.versions.electron !== undefined;
  if (entry !== undefined && /(^|[/\\])bin\.(mjs|ts)$/.test(entry)) {
    return electron
      ? ["/usr/bin/env", "ELECTRON_RUN_AS_NODE=1", process.execPath, entry]
      : [process.execPath, entry];
  }
  if (electron) return null;
  const runtime = NodePath.basename(process.execPath).replace(/\.exe$/i, "");
  return ["node", "bun", "deno"].includes(runtime) ? null : [process.execPath];
}
