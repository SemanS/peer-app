// @effect-diagnostics nodeBuiltinImport:off - public reads use the local broker socket.
/** Public reads use the named checkout, never an agent selected by pane, timing or directory. */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { PeerSessionView } from "../plugin.ts";
import type { CoordinationBroker } from "./Broker.ts";
import { commandArguments, coordinationLog, pluginCommand } from "./cli.ts";
import { hubRead, refused, usage } from "./cliContract.ts";
import { headerOf } from "./server.ts";
import { pluginsForWorkspace } from "./pluginScope.ts";
import type * as NodeHttp from "node:http";

export const PUBLIC_COMMANDS = new Set(["status", "index", "log"]);

export async function publicCli(
  broker: CoordinationBroker,
  command: string,
  args: ReadonlyArray<string>,
  headers: NodeHttp.IncomingHttpHeaders,
): Promise<string> {
  const cwd = headerOf(headers, "x-peer-cwd");
  const place = cwd === undefined ? null : await broker.host.placeOf(cwd);
  if (place === null)
    throw refused(
      "this directory is outside a workspace project",
      "run peer from a workspace project, or use the Peer app.",
    );
  const { workspace, project, root, repositoryId } = place;
  const parsed = commandArguments(args);
  const local = new Map<string, unknown>();
  const session: PeerSessionView = {
    id: "",
    agent: "claude",
    adapter: "hooks",
    runtimeGeneration: "",
    workspace,
    project,
    root,
    cwd: cwd ?? root,
    repositoryId,
    task: undefined,
    thread: undefined,
    pane: undefined,
    status: "idle",
    files: [],
    claims: [],
    public: true,
    local: <S>(id: string, init: () => S): S => {
      if (!local.has(id)) local.set(id, init());
      return local.get(id) as S;
    },
  };
  const plugins = pluginsForWorkspace(await broker.plugins(), workspace);
  const owned = pluginCommand(plugins, command);
  if (owned !== undefined) {
    if ("refusal" in owned)
      throw refused(
        owned.refusal.replace(/^peer: /, ""),
        owned.next ?? "ask your person to enable the plugin in Peer.",
      );
    const answer = await broker.host.run(
      Effect.result(owned.run.run({ ...parsed, session, cwd })),
      { signal: broker.stopping.signal },
    );
    if (Result.isFailure(answer)) throw answer.failure;
    return answer.success;
  }
  if (command === "log")
    return coordinationLog(broker, place, parsed.flag("--task"), parsed.flag("--path"));
  const view = await hubRead(
    command,
    () => broker.host.view(workspace),
    `run peer ${command} again when the Hub is reachable.`,
  );
  const agents = broker
    .merged(workspace, view)
    .sessions.filter((agent) => agent.project === project);
  const rows = broker.host
    .tasks(workspace, project)
    .filter((task) => task.chat !== true)
    .map((task) => `${task.key ?? task.id} · ${task.title} · ${task.status}`);
  if (command === "status")
    return [
      `Peer · project ${project}`,
      ...agents.map((agent) => broker.boardAgent(workspace, agent)),
      ...rows,
    ].join("\n");
  const page = Number(parsed.plain[0] ?? 1);
  const pages = Math.max(1, Math.ceil(rows.length / 12));
  if (!Number.isInteger(page) || page < 1 || page > pages)
    throw usage(`choose an index page from 1 to ${pages}`, "run peer index <page>.");
  return (
    [
      ...rows.slice((page - 1) * 12, page * 12),
      ...(agents.length > 0 ? agents.map((agent) => broker.boardAgent(workspace, agent)) : []),
    ].join("\n") || "peer: no work on this project now."
  );
}
