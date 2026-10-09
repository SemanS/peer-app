// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - a local socket for agents' hooks, the peer command and Peer Mod's receipts.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * The broker's socket, which only this user may open: agents' hooks (`/hook`, `/hook/wait`), the
 * `peer` command (`/cli/<command>`) and Peer Mod's receipts (`/delivery`, `/usage`).
 *
 * @module peerHub/core/broker/server
 */
import * as NodeHttp from "node:http";

import type { CoordinationBroker } from "./Broker.ts";

export async function route(
  this: CoordinationBroker,
  request: NodeHttp.IncomingMessage,
  response: NodeHttp.ServerResponse,
) {
  try {
    const raw = await readBody(request);
    const url = request.url ?? "/";
    if (url === "/delivery" || url === "/usage") {
      this.modReport(url, request, raw, response);
      return;
    }
    if (url === "/hook" || url === "/hook/wait") {
      const body = parseJson(raw);
      if (url === "/hook") {
        const out = await this.hookInTime(body, request.headers);
        respond(response, out === null ? 204 : 200, out === null ? "" : JSON.stringify(out));
      } else {
        const text = await this.wait(body, request.headers);
        respond(response, text === "" ? 204 : 200, text);
      }
      return;
    }
    if (url.startsWith("/cli/")) {
      const command = url.slice("/cli/".length);
      const args =
        raw === "" ? [] : raw.split("\0").filter((arg, i, all) => i < all.length - 1 || arg !== "");
      const out = await this.runCli(command, args, request.headers);
      this.log("cli", { command, args, out });
      respond(response, 200, `${out}\n`);
      return;
    }
    respond(response, 404, "");
  } catch (error) {
    this.log("broker.error", { error: error instanceof Error ? error.message : String(error) });
    respond(
      response,
      error instanceof CliError ? error.status : 500,
      error instanceof CliError
        ? `${error.message}\n`
        : "peer: the request failed; check Peer's coordination status and retry.\n",
    );
  }
}

export class CliError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function headerOf(headers: NodeHttp.IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  const text = Array.isArray(value) ? value[0] : value;
  return text === undefined || text === "" ? undefined : text;
}

export function parseJson(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** What a hook may carry: a shell command's whole output comes with it. Past this, Peer reads nothing of it. */
const MAX_BODY = 16 * 1024 * 1024;

function readBody(request: NodeHttp.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = "";
    let over = false;
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      if (over) return;
      raw += chunk;
      if (raw.length > MAX_BODY) {
        over = true;
        raw = "";
      }
    });
    // A request that goes away must not leave its handler waiting for good.
    const done = () => resolve(over ? "" : raw);
    request.on("end", done);
    request.on("close", done);
    request.on("error", reject);
  });
}

export function respond(response: NodeHttp.ServerResponse, status: number, body: string) {
  if (response.writableEnded) return;
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(body);
}

/** Whether a Unix socket path fits the platform's limit (104 bytes on macOS). */
export function socketPathFits(path: string): boolean {
  return Buffer.byteLength(path) < 104;
}
