/**
 * `peer tests`: an agent files a test report on its task (or `--for` another task of its project),
 * or reads a task's reports (`show`) as team reference without recording an input read. Outcomes
 * follow the peer-cli-contract: a refusal the Hub gave is refused, no answer is uncertain (the report
 * may have been filed: `peer tests show` says), a wrong line is usage.
 *
 * @module peerHub/plugins/test-reports/cli
 */
import { PeerHubError, type PeerTask } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  CliError,
  isSignedOut,
  refused,
  uncertain,
  usage,
  type PeerCommand,
  type PeerSessionView,
} from "../../core/plugin.ts";
import type * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import type * as PeerState from "../../core/state/PeerState.ts";
import type * as PeerWork from "../../core/work/PeerWork.ts";
import { emptyShell, seen } from "./evidence.ts";
import { FORM, parse } from "./parse.ts";
import { countsOf, replyLines, showText } from "./render.ts";
import type { TestReports } from "./TestReports.ts";

const SHOW_NEXT = "run peer tests show to see whether it was filed, and file it again only if not.";

/** What a failed Hub call means to the command. */
function failure(error: PeerHubError, filing: boolean): CliError {
  if (isSignedOut(error))
    return refused(error.detail, "ask your person to sign in to Peer, then repeat the command.");
  if (error.code === "unknown_owner")
    return refused(
      error.detail,
      'name a member of the project after @ (as --unverified "<text> @ana"), or leave the owner out.',
    );
  if (error.code === "unknown_task")
    return refused(
      error.detail,
      'name a task of this project by its key after @task: (as --unverified "<text> @task:SEC-3-1"), or an item of the same OpenSpec change by its number (@task:3.1); the report\'s own task does not count.',
    );
  // A Hub from before items could be left to a task refuses the field whole.
  if (error.status === 400 && /unknown field `task`/.test(error.detail))
    return refused(
      "this Peer Hub does not keep the task an unverified item is left to yet",
      'name a person after @ instead (--unverified "<text> @<person>"), or ask your person to give the item an owner on the task page.',
    );
  if (error.code === "not_your_session")
    return refused(
      error.detail,
      "run the command again in a moment: Peer reports your session and its run first. If it is refused again, run peer run and tell your person.",
    );
  if (error.status === 400) return usage(error.detail, `run ${FORM}.`);
  if (error.refused === true || error.status === 403 || error.status === 404)
    return refused(error.detail, "tell your person; repeating this command will not help.");
  return filing
    ? uncertain("tests", "the Hub gave no usable answer", SHOW_NEXT)
    : refused(error.detail, "run peer tests show again when the Hub is reachable.");
}

export const testsCommand = (
  reports: TestReports["Service"],
  work: PeerWork.PeerWork["Service"],
  agents: PeerAgents.PeerAgents["Service"],
  state: PeerState.PeerState["Service"],
): PeerCommand => {
  const taskOf = (session: PeerSessionView, handle: string | undefined) =>
    Effect.gen(function* () {
      const tasks: ReadonlyArray<PeerTask> = yield* work.tasks(session.workspace, session.project);
      const wanted = (handle ?? session.task)?.toLowerCase();
      return tasks.find(
        (task) => task.id.toLowerCase() === wanted || task.key?.toLowerCase() === wanted,
      );
    });
  const name = (session: PeerSessionView) => (email: string) =>
    state.nameOf(session.workspace, email);
  const taskLabel = (session: PeerSessionView) =>
    Effect.map(work.tasks(session.workspace, session.project), (tasks) => (id: string) => {
      const found = tasks.find((task) => task.id === id);
      return found === undefined ? id : (found.key ?? found.id);
    });
  return {
    name: "tests",
    usage:
      'tests pass|fail|mixed "<summary>" [--for <task>] [--pass "<text>"]... [--fail "<text>"]... [--unverified "<text> [@<person>|@task:<key>]"]... | show [<task>]',
    summary: "file a test report on your task, or read a task's reports (reference)",
    run: ({ session, args }) =>
      Effect.gen(function* () {
        const parsed = yield* Effect.try({
          try: () => parse(args),
          catch: (error) =>
            error instanceof CliError ? error : usage(String(error), `run ${FORM}.`),
        });
        if (parsed.task === undefined && session.task === undefined)
          return yield* Effect.fail(
            parsed.kind === "file"
              ? refused(
                  "this session has no task to file a test report on",
                  `name the task with --for, as peer tests ${parsed.result} "<summary>" --for <task>.`,
                )
              : refused("this session has no task", "run peer tests show <task>."),
          );
        const task = yield* taskOf(session, parsed.task);
        if (task === undefined)
          return yield* Effect.fail(
            refused(
              `no task ${parsed.task ?? session.task} in this project`,
              "run peer index for the task names, then repeat the command.",
            ),
          );
        const place = { workspace: session.workspace, project: session.project, task: task.id };
        const label = task.key ?? task.id;
        if (parsed.kind === "show")
          return showText(
            label,
            yield* reports.list(place).pipe(Effect.mapError((e) => failure(e, false))),
            name(session),
            yield* taskLabel(session),
          );
        const shell = session.local("test-reports", emptyShell);
        const items = parsed.items.map((item) => {
          const mark = item.kind === "unverified" ? undefined : seen(shell, item.text);
          return mark === undefined ? item : { ...item, seen: mark };
        });
        const answer = yield* reports
          .file(place, {
            result: parsed.result,
            summary: parsed.summary,
            items,
            session: session.id,
            ...(session.run === undefined ? {} : { run: session.run }),
          })
          .pipe(
            Effect.tapError((error) =>
              agents.log("tests.refused", { session: session.id, code: error.code ?? null }),
            ),
            Effect.mapError((e) => failure(e, true)),
          );
        const counts = countsOf(answer.report);
        yield* agents.log("tests.filed", {
          session: session.id,
          number: answer.report.number,
          changed: answer.changed,
          passed: counts.passed,
          failed: counts.failed,
          unverified: counts.unverified,
          unowned: counts.unowned.length,
          seen: items.filter((item) => "seen" in item).length,
        });
        return replyLines({
          label,
          filed: parsed.result,
          report: answer.report,
          changed: answer.changed,
        }).join("\n");
      }),
  };
};
