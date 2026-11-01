// @effect-diagnostics preferSchemaOverJson:off - JSON-RPC catalog revisions and compact wire messages.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { CliError, refused, render, usage, type PeerSessionView } from "../../core/plugin.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import { protocol } from "./protocol.ts";

export class Sessions extends Context.Service<
  Sessions,
  {
    readonly message: (
      line: string,
      headers: Readonly<Record<string, string | undefined>>,
    ) => Effect.Effect<string, CliError>;
    readonly end: Effect.Effect<void>;
    readonly forgetAbsent: (workspaces: ReadonlyArray<string>) => Effect.Effect<void>;
  }
>()("t3/peerHub/plugins/mcp/sessions") {}

const make = Effect.gen(function* () {
  const agents = yield* PeerAgents.PeerAgents;
  const context = yield* Effect.context<never>();
  const run = Effect.runPromiseWith(context);
  const servers = new Map<string, string>();
  const started = new Set<string>();
  /** The name each MCP client gave on `initialize`, by its conversation id. */
  const clients = new Map<string, string>();
  const calling = new Map<string, Promise<{ readonly text: string; readonly isError: boolean }>>();
  let generation = 0;
  let allowedWorkspaces: ReadonlySet<string> | undefined;
  const binding = (headers: Readonly<Record<string, string | undefined>>, server: string) =>
    agents.bindTools({
      server,
      ...(headers["x-peer-session"] ? { session: headers["x-peer-session"] } : {}),
      ...(headers["x-peer-session-token"] ? { token: headers["x-peer-session-token"] } : {}),
      ...(headers["x-peer-run"] ? { run: headers["x-peer-run"] } : {}),
      ...(headers["x-peer-run-token"] ? { runToken: headers["x-peer-run-token"] } : {}),
      ...(headers["x-peer-thread"] ? { thread: headers["x-peer-thread"] } : {}),
      ...(headers["x-herdr-pane"] ? { pane: headers["x-herdr-pane"] } : {}),
      ...(headers["x-peer-cwd"] ? { cwd: headers["x-peer-cwd"] } : {}),
      ...(headers["x-peer-harness"] ? { harness: headers["x-peer-harness"] } : {}),
      ...(clients.has(server) ? { client: clients.get(server)! } : {}),
    });
  const close = Effect.fnUntraced(function* (server: string) {
    const session = servers.get(server);
    servers.delete(server);
    clients.delete(server);
    if (session === undefined || [...servers.values()].includes(session)) return;
    yield* Effect.promise(async () => {
      await calling.get(session)?.catch(() => undefined);
    });
    if ([...servers.values()].includes(session)) return;
    started.delete(session);
    yield* agents.endTools(session);
  });
  const message = Effect.fnUntraced(function* (
    line: string,
    headers: Readonly<Record<string, string | undefined>>,
  ) {
    const server = headers["x-peer-mcp"];
    if (server === undefined || !/^[a-zA-Z0-9_.-]{1,200}$/.test(server))
      return yield* Effect.fail(
        refused(
          "the MCP server has no conversation id",
          "start peer mcp through the generated Peer command.",
        ),
      );
    if (line === "--end") {
      yield* close(server);
      return "";
    }
    const requestGeneration = generation;
    const { instructions, tools: catalog } = yield* agents.tools;
    let session: PeerSessionView | undefined;
    const getSession = async () => {
      if (session !== undefined) return session;
      session = await run(binding(headers, server));
      if (
        requestGeneration !== generation ||
        (allowedWorkspaces !== undefined && !allowedWorkspaces.has(session.workspace))
      ) {
        await run(agents.endTools(session.id));
        throw refused(
          "MCP coordination became unavailable while the agent was registering",
          "check the plugin and workspace access in Peer, then restart the MCP client.",
        );
      }
      servers.set(server, session.id);
      return session;
    };
    return yield* Effect.promise(() =>
      protocol(line, {
        instructions: () => instructions,
        client: (info) => {
          clients.set(server, info.name);
        },
        tools: () => catalog,
        call: async (command, args) => {
          // Sharing is how a session Peer ignores gets in, so it runs without one.
          if (command === "share") {
            const cwd = headers["x-peer-cwd"];
            if (cwd === undefined)
              return {
                text: render(
                  usage(
                    "peer_share needs the folder it runs in",
                    "restart the MCP client from the project.",
                  ),
                ),
                isError: true,
              };
            return run(agents.share(cwd, args)).then(
              (text) => ({ text, isError: false }),
              (failure) => ({
                text: render(
                  failure instanceof CliError
                    ? failure
                    : refused(
                        "Peer could not share this project",
                        "ask your person to share it in Peer's Tasks.",
                      ),
                ),
                isError: true,
              }),
            );
          }
          const bound = await getSession();
          const previous = calling.get(bound.id);
          const current = (async () => {
            await previous?.catch(() => undefined);
            const first = !started.has(bound.id);
            if (first)
              await run(
                agents.log("mcp.session", {
                  session: bound.id,
                  tools: JSON.stringify(
                    catalog.map(({ name, description, inputSchema }) => ({
                      name,
                      description,
                      inputSchema,
                    })),
                  ).length,
                }),
              );
            const reply = await run(agents.callTools(bound.id, command, args, first));
            started.add(bound.id);
            return reply;
          })();
          calling.set(bound.id, current);
          try {
            return await current;
          } finally {
            if (calling.get(bound.id) === current) calling.delete(bound.id);
          }
        },
      }),
    );
  });
  const end = Effect.gen(function* () {
    generation++;
    for (const server of servers.keys()) yield* close(server);
  });
  const forgetAbsent = Effect.fnUntraced(function* (workspaces: ReadonlyArray<string>) {
    allowedWorkspaces = new Set(workspaces);
    const live = yield* agents.sessions;
    const absent = new Set(
      live
        .filter((session) => !workspaces.includes(session.workspace))
        .map((session) => session.id),
    );
    for (const [server, session] of servers) if (absent.has(session)) yield* close(server);
  });
  return Sessions.of({ message, end, forgetAbsent });
});
export const layer = Layer.effect(Sessions, make);
