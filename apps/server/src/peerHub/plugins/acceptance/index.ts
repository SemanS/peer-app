/**
 * The acceptance plugin: a project's lead (or an admin) accepts a task's delivered work, as a fact
 * on the task that whoever pays or reports can rely on, and withdraws it, which is recorded too
 * (the Hub's `acceptance` feature). Accepting a task in review finishes it as the lead's own move.
 * It gates nothing: no hook verdict, no `beforeReview`, no command; agents read it in `peer status`
 * and on the task's line in `peer task list`.
 *
 * @module peerHub/plugins/acceptance
 */
import { PEER_ACCEPTANCE_PLUGIN } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as Acceptance from "./Acceptance.ts";
import { acceptanceRpc } from "./client/transport.ts";
import { statusLine, taskFact } from "./tell.ts";

export const AcceptancePlugin = bindPlugin({
  ...PEER_ACCEPTANCE_PLUGIN,
  id: "acceptance",
  layer: Acceptance.layer,
  make: Effect.gen(function* () {
    const acceptance = yield* Acceptance.Acceptance;
    const state = yield* PeerState.PeerState;
    return {
      // The core's `commandReply` follows only `peer review` and `peer done`; `peer status` asks
      // plugins for a block, so the fact goes there.
      statusBlock: (session) =>
        Effect.sync(() => {
          if (session.task === undefined) return null;
          const place = {
            workspace: session.workspace,
            project: session.project,
            task: session.task,
          };
          const task = state
            .current()
            .work.get(`${session.workspace}/${session.project}`)
            ?.tasks.find((candidate) => candidate.id === session.task);
          return statusLine(acceptance.known(place), task?.status, (email) =>
            state.nameOf(session.workspace, email),
          );
        }),
      taskFacts: (place, tasks) =>
        Effect.sync(() => {
          const facts = new Map<string, string>();
          for (const task of tasks) {
            const fact = taskFact(
              acceptance.known({ ...place, task: task.id }),
              task.status,
              (email) => state.nameOf(place.workspace, email),
            );
            if (fact !== null) facts.set(task.id, fact);
          }
          return facts;
        }),
      hubChanges: {
        changes: ["acceptance.changed", "resync"],
        onPing: (ping) =>
          ping.change === "resync" ? acceptance.readAll : acceptance.readSoon(ping.workspace),
      },
      workspaceCleanup: (event) =>
        event.kind === "signing-out"
          ? acceptance.forget()
          : event.kind === "left-workspace"
            ? acceptance.forget(event.workspace)
            : acceptance.keep(event.workspaces.map((workspace) => workspace.slug)),
      status: { read: acceptance.status },
      turnOff: acceptance.forget(),
      rpc: acceptanceRpc(acceptance),
      run: acceptance.follow,
    } satisfies PeerContributions;
  }),
});
