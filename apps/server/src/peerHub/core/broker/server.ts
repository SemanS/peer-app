// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off globalTimers:off - a local socket for agents' hooks, the peer command and Peer Mod's receipts.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * The broker's socket, which only this user may open: agents' hooks (`/hook`, `/hook/wait`), the
 * `peer` command (`/cli/<command>`), who owns it (`/owner`, `/owner/handover`), runs for the terminal's
 * Peer Core process (`/runs`) and Peer Mod's receipts (`/delivery`, `/usage`).
 *
 * @module peerHub/core/broker/server
 */
import * as NodeHttp from "node:http";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { CoordinationBroker } from "./Broker.ts";
import { CliError, refused, render, uncertain, usage } from "./cliContract.ts";

export async function route(
  this: CoordinationBroker,
  request: NodeHttp.IncomingMessage,
  response: NodeHttp.ServerResponse,
) {
  const command = request.url?.startsWith("/cli/") ? request.url.slice(5) : undefined;
  try {
    const raw = await readBody(request);
    const url = request.url ?? "/";
    if (url === "/owner" && request.method === "GET") {
      const owner = this.owner;
      respond(response, owner === null ? 404 : 200, owner === null ? "" : JSON.stringify(owner));
      return;
    }
    if (url === "/owner/handover" && request.method === "POST") {
      // Only Peer Core steps aside; the app's broker stays until the app stops.
      if (this.kind !== "peer-core") {
        respond(response, 409, "peer: refused: the Peer app runs coordination here.\n");
        return;
      }
      respond(response, 202, "");
      setImmediate(() => void this.handOver());
      return;
    }
    if (url === "/delivery" || url === "/usage") {
      this.modReport(url, request, raw, response);
      return;
    }
    if (url === "/hook" || url === "/hook/wait") {
      const body = parseJson(raw);
      if (url === "/hook") {
        const out = this.withRunNotice(
          body,
          request.headers,
          await this.hookInTime(body, request.headers),
        );
        respond(response, out === null ? 204 : 200, out === null ? "" : JSON.stringify(out));
      } else {
        const text = await this.wait(body, request.headers);
        respond(response, text === "" ? 204 : 200, text);
      }
      return;
    }
    const runs = await this.runsRoute(request.method, url, raw);
    if (runs !== undefined) {
      respondJson(response, runs.status, runs.body);
      return;
    }
    if (url.startsWith("/cli/")) {
      const command = url.slice("/cli/".length);
      const args =
        raw === "" ? [] : raw.split("\0").filter((arg, i, all) => i < all.length - 1 || arg !== "");
      const owned = (await this.plugins()).commands.find((entry) => entry.command.name === command);
      if (owned?.command.stdio !== undefined) {
        if (owned.refused !== undefined)
          throw refused(
            `${command} is turned off on this environment`,
            "ask your person to enable the plugin in Settings → Peer → Coordination & plugins.",
          );
        const out = await this.host.run(
          Effect.result(
            owned.command.stdio({
              line: args[0] ?? "",
              headers: Object.fromEntries(
                Object.keys(request.headers).map((key) => [key, headerOf(request.headers, key)]),
              ),
            }),
          ),
          { signal: this.stopping.signal },
        );
        if (Result.isFailure(out)) throw out.failure;
        respond(response, 200, out.success === "" ? "" : `${out.success}\n`);
        return;
      }
      const out = await this.runCli(command, args, request.headers);
      this.record("cli", {
        session: headerOf(request.headers, "x-peer-session"),
        command,
        args,
        out,
        outcome: "done",
      });
      respond(response, 200, `${out}\n`);
      return;
    }
    respond(response, 404, "");
  } catch (error) {
    if (!(error instanceof CliError))
      this.record("broker.error", {
        error: error instanceof Error ? error.message : String(error),
      });
    if (command === undefined) {
      respond(
        response,
        500,
        "peer: the request failed; check Peer's coordination status and retry.\n",
      );
      return;
    }
    const failure = error instanceof CliError ? error : uncertain(command ?? "command");
    if (command !== undefined)
      this.record("cli", {
        session: headerOf(request.headers, "x-peer-session"),
        command,
        outcome: failure.outcome,
        reason: failure.reason,
      });
    respond(response, failure.status, `${render(failure)}\n`);
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
    const done = () =>
      over
        ? reject(usage("request body exceeds the limit", "send a smaller peer command."))
        : resolve(raw);
    request.on("end", done);
    request.on("close", () => {
      if (!request.complete)
        reject(
          refused(
            "request ended before its arguments arrived; nothing was sent to a handler",
            "repeat the complete command.",
          ),
        );
    });
    request.on("error", reject);
  });
}

function respondJson(response: NodeHttp.ServerResponse, status: number, body: unknown) {
  if (response.writableEnded) return;
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
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
