// @effect-diagnostics preferSchemaOverJson:off - JSON-RPC catalog revisions and compact wire messages.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { CliError, refused, type PeerSessionView } from "../../core/plugin.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import { protocol } from "./protocol.ts";
import { tools } from "./tools.ts";

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
  const plugins = yield* PeerPlugins.PeerPlugins;
  const context = yield* Effect.context<never>();
  const run = Effect.runPromiseWith(context);
  const servers = new Map<string, string>();
  const started = new Set<string>();
  const promptLists = new Map<string, string>();
  const calling = new Map<string, Promise<{ readonly text: string; readonly isError: boolean }>>();
  const binding = (headers: Readonly<Record<string, string | undefined>>, server: string) =>
    agents.bindTools({
      server,
      ...(headers["x-peer-session"] ? { session: headers["x-peer-session"] } : {}),
      ...(headers["x-peer-session-token"] ? { token: headers["x-peer-session-token"] } : {}),
      ...(headers["x-peer-thread"] ? { thread: headers["x-peer-thread"] } : {}),
      ...(headers["x-herdr-pane"] ? { pane: headers["x-herdr-pane"] } : {}),
    });
  const close = Effect.fnUntraced(function* (server: string) {
    const session = servers.get(server);
    servers.delete(server);
    promptLists.delete(server);
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
    const contributions = yield* plugins.contributions;
    const catalog = [...tools, ...contributions.flatMap((entry) => entry.agentTools ?? [])];
    let session: PeerSessionView | undefined;
    const getSession = async () => {
      if (session !== undefined) return session;
      session = await run(binding(headers, server));
      servers.set(server, session.id);
      return session;
    };
    const providers = contributions.flatMap((entry) =>
      entry.agentPrompts === undefined ? [] : [entry.agentPrompts],
    );
    const list = async () => {
      if (providers.length === 0) return [];
      const bound = await getSession();
      return (await Promise.all(providers.map((provider) => run(provider.list(bound))))).flat();
    };
    const answer = yield* Effect.promise(() =>
      protocol(line, {
        tools: () => catalog,
        call: async (command, args) => {
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
        prompts: list,
        prompt: async (name, args) => {
          const bound = await getSession();
          for (const provider of providers)
            if ((await run(provider.list(bound))).some((prompt) => prompt.name === name))
              return run(provider.get(bound, name, args));
          throw refused(`no prompt ${name}`, "list the available Peer prompts.");
        },
      }),
    );
    // Notification is sent between replies. The next request is the earliest observable refresh.
    if (
      (session !== undefined || servers.has(server)) &&
      (providers.length > 0 || promptLists.has(server))
    ) {
      const current = JSON.stringify(yield* Effect.promise(list));
      const previous = promptLists.get(server);
      promptLists.set(server, current);
      if (previous !== undefined && previous !== current)
        return `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/prompts/list_changed" })}\n${answer}`;
    }
    return answer;
  });
  const end = Effect.gen(function* () {
    for (const server of servers.keys()) yield* close(server);
  });
  const forgetAbsent = Effect.fnUntraced(function* (workspaces: ReadonlyArray<string>) {
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
