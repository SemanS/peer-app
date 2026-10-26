// @effect-diagnostics nodeBuiltinImport:off - the folder's name in what the agent is told.
/**
 * `peer share`: an agent in a project that is only on this computer shares it with its person's
 * workspace, as "Share a project with your team" does in Peer, with the person's rights. Peer
 * ignores agent sessions outside workspace projects, so this is the one command such a session can
 * run; once the project is shared, Peer takes the session in at its next step.
 *
 * @module peerHub/core/broker/share
 */
import * as NodePath from "node:path";
import { PEER_LOCAL_WORKSPACE } from "@t3tools/contracts";

import { plain } from "../../peerText.ts";
import type { CoordinationBroker } from "./Broker.ts";
import { hubWrite, refused, usage } from "./cliContract.ts";
import { headerOf } from "./server.ts";
import type * as NodeHttp from "node:http";

export const SHARE_FLAGS = ["--workspace", "--name"];
export const SHARE_HELP = {
  name: "share",
  usage: 'share [--workspace <slug>] [--name "<name>"]',
  summary: "share this project, now only on this computer, with your person's workspace",
};

/** What an agent is told where Peer ignores its session: why, and how it gets in. */
export const UNSHARED = (folder: string) =>
  refused(
    `${plain(NodePath.basename(folder), 80)} is a project only on this computer: no Peer workspace shares it, so it has no team tasks, settings or coordination, and Peer does not register agent sessions there`,
    "if your person wants it in their workspace, run peer share (the peer_share tool), or they choose Share with <workspace>… in the project menu at the top of Peer's sidebar; then start a new session or continue here.",
  );

export async function shareCommand(
  broker: CoordinationBroker,
  args: ReadonlyArray<string>,
  headers: NodeHttp.IncomingHttpHeaders,
): Promise<string> {
  const cwd = headerOf(headers, "x-peer-cwd");
  if (cwd === undefined)
    throw usage(
      "peer share needs the folder it runs in",
      "run peer share from the project's shell.",
    );
  const flag = (name: string) => {
    const at = args.indexOf(name);
    return at < 0 ? undefined : args[at + 1];
  };
  if (args.some((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--")))
    throw usage(`use peer ${SHARE_HELP.usage}`, "run peer help for the commands.");
  const place = await broker.host.placeOf(cwd);
  if (place !== null && place.workspace !== PEER_LOCAL_WORKSPACE)
    return `This folder already is project ${plain(place.project, 80)} of ${plain(place.workspace, 80)}; there is nothing to share.`;
  if (broker.host.shareFolder === undefined)
    throw refused("this Peer cannot share projects for agents", "ask your person to update Peer.");
  const workspaces = broker.host
    .workspaces()
    .filter((workspace) => workspace !== PEER_LOCAL_WORKSPACE);
  const asked = flag("--workspace");
  if (workspaces.length === 0)
    throw refused(
      "your person's Peer is in no workspace",
      "ask your person to sign Peer in to its Hub and join a workspace.",
    );
  if (asked !== undefined && !workspaces.includes(asked))
    throw refused(
      `your person is in no workspace ${plain(asked, 80)}`,
      `choose one of ${workspaces.join(", ")} with --workspace.`,
    );
  if (asked === undefined && workspaces.length > 1)
    throw usage(
      `your person is in ${workspaces.length} workspaces: ${workspaces.join(", ")}`,
      "ask your person which, then run peer share --workspace <slug>.",
    );
  const workspace = asked ?? workspaces[0]!;
  const name = flag("--name")?.trim();
  const shared = await hubWrite(
    "share",
    () => broker.host.shareFolder!(cwd, workspace, name === "" ? undefined : name),
    "ask your person to look in Peer's Tasks whether the project is shared before repeating.",
  );
  // The folder was ignored a moment ago; the session's next step should find its project.
  broker.ignoredCwds.clear();
  return `Shared ${plain(shared.name, 120)} with ${plain(workspace, 80)} as project ${plain(shared.project, 80)}: everyone in the workspace sees it and clones it with Clone & open. Peer registers this session at its next step; peer_task and peer_config_* work after that.`;
}
