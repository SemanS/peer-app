import type { CoordinationBroker } from "../broker/Broker.ts";
import type { CommandArguments } from "../broker/cli.ts";
import { hubRead, refused, usage } from "../broker/cliContract.ts";
import type { PeerSessionView } from "../plugin.ts";

export async function currentViewCommand(
  broker: CoordinationBroker,
  command: "current" | "archive" | "evidence",
  args: CommandArguments,
  session: Pick<PeerSessionView, "workspace" | "project" | "id" | "task">,
): Promise<string> {
  const limit = args.flag("--limit") === undefined ? 20 : Number(args.flag("--limit"));
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw usage("limit must be between 1 and 100", "use --limit 20.");
  const cursor = args.flag("--cursor");
  const place = {
    workspace: session.workspace,
    project: session.project,
    limit,
    ...(cursor === undefined ? {} : { cursor }),
  };
  if (command === "archive") {
    if (broker.host.contextArchive === undefined)
      throw refused("context archive is unavailable", "update Peer and retry.");
    const history = args.flag("--history");
    if (history !== undefined && history !== "true" && history !== "false")
      throw usage("history must be true or false", "use --history true.");
    const topic = args.flag("--topic");
    return JSON.stringify(
      await hubRead(
        command,
        () =>
          broker.host.contextArchive!({
            ...place,
            history: history === "true",
            ...(topic === undefined ? {} : { topic }),
          }),
        "retry when the context authority is available.",
      ),
    );
  }
  if (broker.host.contextView === undefined)
    throw refused("current context is unavailable", "update Peer and retry.");
  const handle = args.plain[0];
  const scope =
    handle === "project-aggregate"
      ? handle
      : handle === undefined
        ? session.task === undefined
          ? "project"
          : `task:${session.task}`
        : broker.scopeNamed(session.workspace, session.project, handle);
  if (scope === undefined) throw usage("unknown work", "use peer archive to discover work.");
  const view = await hubRead(
    command,
    () =>
      broker.host.contextView!({
        ...place,
        ...(command === "evidence" ? { cursor: undefined, inputCursor: cursor } : {}),
        scope,
        ...(session.id === "" ? {} : { session: session.id, environment: broker.host.environment }),
      }),
    "retry when the context authority is available.",
  );
  return JSON.stringify(
    command === "evidence"
      ? {
          identity: view.identity,
          inputs: view.inputs,
          generatedAt: view.generatedAt,
          verifiedAt: view.verifiedAt,
        }
      : view,
  );
}
