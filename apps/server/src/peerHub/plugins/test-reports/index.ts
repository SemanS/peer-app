/**
 * The test-reports plugin: an agent files what its task was tested against with `peer tests`, items
 * it saw the session run are marked seen by Peer, and the Hub (its `test-reports` feature) keeps the
 * latest report per task and author and refuses an agent's `peer done` while an unverified item has
 * no owner. People read reports, file their own and give items owners from the task page.
 *
 * @module peerHub/plugins/test-reports
 */
import { PEER_TEST_REPORTS_PLUGIN } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import { testsCommand } from "./cli.ts";
import { testReportsRpc, testsTools } from "./client/transport.ts";
import { emptyShell, remember } from "./evidence.ts";
import { inheritedBlock } from "./render.ts";
import * as TestReports from "./TestReports.ts";

export const START_LINE =
  'Before peer done, file what you tested: peer tests pass|fail|mixed "<summary>" --pass "<command>" --unverified "<what it should have checked> @<person>". A dependent task can carry an item: "<text> @task:<key>", on --fail too. Unverified items need an owner or a task, failed ones a task.';

/** A session's start does not wait long for what a slow Hub would add. */
const INHERITED_MS = 1500;

export const TestReportsPlugin = bindPlugin({
  ...PEER_TEST_REPORTS_PLUGIN,
  id: "test-reports",
  commandNames: ["tests"],
  layer: TestReports.layer,
  make: Effect.gen(function* () {
    const reports = yield* TestReports.TestReports;
    const work = yield* PeerWork.PeerWork;
    const agents = yield* PeerAgents.PeerAgents;
    const state = yield* PeerState.PeerState;
    return {
      commands: [testsCommand(reports, work, agents, state)],
      agentTools: testsTools,
      hooks: {
        startLine: Effect.succeed(START_LINE),
        sessionStart: ({ session }) =>
          session.task === undefined
            ? Effect.succeed(null)
            : reports
                .inherited({
                  workspace: session.workspace,
                  project: session.project,
                  task: session.task,
                })
                .pipe(
                  Effect.timeout(`${INHERITED_MS} millis`),
                  Effect.map(inheritedBlock),
                  Effect.orElseSucceed(() => null),
                ),
        // The session's shell history, for "seen run by Peer"; nothing is said to the agent.
        postTool: (ctx) =>
          ctx.command === undefined
            ? Effect.succeed(null)
            : Clock.currentTimeMillis.pipe(
                Effect.map((now) => {
                  remember(
                    ctx.session.local("test-reports", emptyShell),
                    ctx.command!,
                    ctx.failed === true,
                    now,
                  );
                  return null;
                }),
              ),
      },
      hubChanges: {
        changes: ["tests.changed", "resync"],
        onPing: (ping) => {
          if (ping.change === "resync") return reports.readAll;
          const { projectId, taskId } = ping.data;
          return typeof projectId === "string" && typeof taskId === "string"
            ? reports.readSoon({ workspace: ping.workspace, project: projectId, task: taskId })
            : Effect.void;
        },
      },
      workspaceCleanup: (event) =>
        event.kind === "signing-out"
          ? reports.forget()
          : event.kind === "left-workspace"
            ? reports.forget(event.workspace)
            : reports.keep(event.workspaces.map((workspace) => workspace.slug)),
      status: { read: reports.status },
      turnOff: reports.forget(),
      rpc: testReportsRpc(reports),
      run: reports.follow,
    } satisfies PeerContributions;
  }),
});
