// @effect-diagnostics nodeBuiltinImport:off - public reads use the local broker socket.
/** Public reads use the named checkout, never an agent selected by pane, timing or directory. */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { neutral } from "../../peerText.ts";
import type { PeerSessionView } from "../plugin.ts";
import type { CoordinationBroker } from "./Broker.ts";
import { commandArguments, commandsOn, pluginCommand } from "./cli.ts";
import { hubRead, refused, usage } from "./cliContract.ts";
import { headerOf } from "./server.ts";
import type * as NodeHttp from "node:http";

export const PUBLIC_COMMANDS = new Set(["status", "index", "context", "knowledge", "log"]);

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
    keeps: false,
    files: [],
    claims: [],
    public: true,
    local: <S>(id: string, init: () => S): S => {
      if (!local.has(id)) local.set(id, init());
      return local.get(id) as S;
    },
  };
  const plugins = await broker.plugins();
  if (pluginCommand(plugins, command) !== undefined) {
    const owned = pluginCommand(plugins, command);
    if (owned === undefined)
      throw refused("knowledge is unavailable on this computer", "use peer index or the Peer app.");
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
  if (command === "context") {
    const first = parsed.plain[0];
    const own = first === undefined || first === "history" || /^\d+$/.test(first);
    const scope = own ? "project" : broker.scopeNamed(workspace, project, first);
    if (scope === undefined)
      throw usage(`no task "${first}" on ${project}`, "run peer index for the task names.");
    const which = own ? first : parsed.plain[1];
    const next = "run peer context again when the Hub is reachable.";
    if (which === "history") {
      const versions = await hubRead(
        command,
        () => broker.host.contextVersions(workspace, project, scope),
        next,
      );
      return versions.length === 0
        ? "The shared context has no versions yet."
        : versions.map((v) => `${v.version} ${v.at} +${v.added} -${v.dropped}`).join("\n");
    }
    if (which !== undefined && (!/^\d+$/.test(which) || Number(which) < 1))
      throw usage("say which context version", "run peer context 7, or peer context history.");
    const context =
      which === undefined
        ? await hubRead(command, () => broker.host.readContext(workspace, project, scope), next)
        : await hubRead(
            command,
            () => broker.host.readContextVersion(workspace, project, scope, Number(which)),
            next,
          );
    if (context === null) {
      if (which !== undefined)
        throw usage(
          `version ${which} is not kept`,
          "run peer context history for the kept versions.",
        );
      return "Nobody has written this shared context yet.";
    }
    return `The shared context of ${broker.subjectOf(workspace, project, scope)}, version ${context.version}.\n<shared-context>\n${neutral(context.text.trim())}\n</shared-context>`;
  }
  if (command === "log") {
    if (broker.host.coordEvents === undefined)
      throw refused(
        "this Hub does not provide coordination history",
        "ask your person to update the Peer Hub.",
      );
    const task = parsed.flag("--task");
    const scope = task === undefined ? undefined : broker.scopeNamed(workspace, project, task);
    const path = parsed.flag("--path");
    const events = await hubRead(
      command,
      () =>
        broker.host.coordEvents!(workspace, project, {
          ...(scope?.startsWith("task:") ? { task: scope.slice(5) } : {}),
          ...(path === undefined ? {} : { path }),
          limit: 50,
        }),
      "run peer log again when the Hub is reachable.",
    );
    return events.length === 0
      ? "No coordination events yet."
      : events
          .map(
            (event) =>
              `${event.at} ${event.kind} ${event.scope ?? event.task ?? ""} ${event.paths.join(", ")}`,
          )
          .join("\n");
  }
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
    .map((task) => `${task.key ?? task.id} · ${task.title} · ${task.status}`);
  if (command === "status")
    return [
      `Peer · project ${project}`,
      ...agents.map((agent) => broker.boardAgent(workspace, agent)),
      ...rows,
    ].join("\n");
  const entries =
    plugins.indexSource === undefined
      ? []
      : await broker.host.run(plugins.indexSource.entries(session));
  const page = Number(parsed.plain[0] ?? 1);
  const pages = Math.max(1, Math.ceil(rows.length / 12));
  if (!Number.isInteger(page) || page < 1 || page > pages)
    throw usage(`choose an index page from 1 to ${pages}`, "run peer index <page>.");
  const knowledge = page === 1 ? broker.indexSection(plugins, entries, 40, true) : null;
  return (
    [
      ...rows.slice((page - 1) * 12, page * 12),
      ...(knowledge ? [knowledge] : []),
      ...(agents.length > 0 ? agents.map((agent) => broker.boardAgent(workspace, agent)) : []),
    ].join("\n") ||
    `peer: no work on this project now.${commandsOn(plugins)("knowledge") ? " Use peer knowledge for its knowledge." : ""}`
  );
}
