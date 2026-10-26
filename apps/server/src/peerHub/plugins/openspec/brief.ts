/**
 * `peer brief plan|apply` and the `peer_brief` tool: an agent compares its project's tasks with the
 * repository's OpenSpec changes, shows its person the plan, and applies only the items the person
 * confirmed. A plan lives 15 minutes for the session that made it; an item whose brief changed
 * since is skipped, and nothing is ever deleted.
 *
 * @module peerHub/plugins/openspec/brief
 */
import type { PeerTaskBrief } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import {
  refused,
  usage,
  type CliError,
  type PeerAgentTool,
  type PeerCommand,
  type PeerSessionView,
} from "../../core/plugin.ts";
import type { PeerState } from "../../core/state/PeerState.ts";
import type { PeerWork } from "../../core/work/PeerWork.ts";
import { plain } from "../../peerText.ts";
import type { OpenSpec } from "./OpenSpec.ts";
import { planItems, planLine, type PlanItem, type PlannedTask } from "./plan.ts";
import { listChanges } from "./client/read.ts";

const USAGE = "brief plan [--repository <id>] | brief apply <item>...";
const KEEP_MS = 15 * 60_000;

interface Services {
  readonly openspec: OpenSpec["Service"];
  readonly work: PeerWork["Service"];
  readonly state: PeerState["Service"];
}

const plans = new Map<
  string,
  { readonly at: number; readonly items: ReadonlyArray<PlanItem>; readonly scope: Scope }
>();
interface Scope {
  readonly workspace: string;
  readonly projectId: string;
  readonly repositoryId: string | undefined;
}

const failed = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === "string" ? error : "it failed";

function plan(services: Services, session: PeerSessionView, repositoryId: string | undefined) {
  return Effect.gen(function* () {
    const scope: Scope = { workspace: session.workspace, projectId: session.project, repositoryId };
    const tasks = (yield* services.work.tasks(scope.workspace, scope.projectId)).filter(
      (task) => task.status !== "done",
    );
    const read = (taskId: string) =>
      services.openspec.source({
        workspace: scope.workspace,
        projectId: scope.projectId,
        taskId,
        ...(repositoryId === undefined ? {} : { repositoryId }),
      });
    const planned: Array<PlannedTask> = [];
    let repository = repositoryId;
    let served = true;
    for (const task of tasks) {
      const now = yield* read(task.id);
      served = now.served;
      repository ??= now.repositoryId;
      if (now.result.link !== undefined) planned.push({ task, link: now.result.link });
    }
    if (!served)
      return yield* Effect.fail(
        refused(
          "the Hub your person is signed in to does not keep task briefs yet",
          "update tasks with peer_task instead.",
        ),
      );
    let changes: ReadonlyArray<{ readonly name: string; readonly title: string }> = [];
    if (repository !== undefined) {
      const runtime = yield* services.state.read;
      const checkout = services.state.checkoutPath(
        runtime.persisted,
        scope.workspace,
        scope.projectId,
        repository,
      );
      changes = yield* Effect.promise(() => listChanges(checkout).catch(() => []));
    }
    const items = planItems(planned, changes);
    plans.set(session.id, {
      at: yield* Clock.currentTimeMillis,
      items,
      scope: { ...scope, repositoryId: repository },
    });
    if (items.length === 0)
      return "Every task's brief matches the repository's OpenSpec changes; nothing to update.";
    return [
      `Plan to update ${plain(scope.projectId, 80)}'s tasks from OpenSpec (nothing has changed yet):`,
      ...items.map(planLine),
      "",
      "Show your person this plan and ask which items to apply. Then call peer_brief with action apply and only the item ids they confirmed. The plan expires in 15 minutes.",
    ].join("\n");
  });
}

function apply(services: Services, session: PeerSessionView, ids: ReadonlyArray<string>) {
  return Effect.gen(function* () {
    const kept = plans.get(session.id);
    if (kept === undefined || (yield* Clock.currentTimeMillis) - kept.at > KEEP_MS)
      return yield* Effect.fail(
        refused("this session has no current plan", "run peer_brief with action plan first."),
      );
    const { scope } = kept;
    const target = (taskId: string) => ({
      workspace: scope.workspace,
      projectId: scope.projectId,
      taskId,
    });
    const lines: Array<string> = [];
    for (const id of ids) {
      const item = kept.items.find((one) => one.id === id);
      if (item === undefined) {
        lines.push(`${id}: no such item in the plan; skipped.`);
        continue;
      }
      const done = yield* Effect.gen(function* () {
        if (item.kind === "create") {
          const before = new Set(
            (yield* services.work.tasks(scope.workspace, scope.projectId)).map((task) => task.id),
          );
          yield* services.work.createTask({
            workspace: scope.workspace,
            projectId: scope.projectId,
            title: (item.title ?? item.change ?? "").slice(0, 200),
          });
          const created = (yield* services.work.tasks(scope.workspace, scope.projectId)).find(
            (task) => !before.has(task.id),
          );
          if (created === undefined) return "created the task, but could not find it to link it";
          yield* services.openspec.link({
            ...target(created.id),
            expectedRevision: 0,
            ...(item.change === undefined ? {} : { change: item.change }),
            ...(scope.repositoryId === undefined ? {} : { repositoryId: scope.repositoryId }),
          });
          return `created and linked task id:${created.id}`;
        }
        const task = item.task!;
        const now = yield* services.openspec.source(target(task.id));
        const revision = (now.brief as PeerTaskBrief | null)?.revision ?? 0;
        if (revision !== item.basis)
          return `skipped: the brief changed since the plan (revision ${revision}); make a new plan`;
        switch (item.kind) {
          case "link":
          case "refresh":
          case "relink":
            yield* services.openspec.link({
              ...target(task.id),
              expectedRevision: revision,
              ...(item.change === undefined ? {} : { change: item.change }),
              ...(scope.repositoryId === undefined ? {} : { repositoryId: scope.repositoryId }),
            });
            return item.kind === "refresh" ? "brief updated" : `linked to ${item.change}`;
          case "unlink":
            yield* services.openspec.unlink({ ...target(task.id), expectedRevision: revision });
            return "kept as the task's own brief";
          case "close":
            yield* services.work.updateTask({ ...target(task.id), status: "done" });
            return "marked done";
        }
      }).pipe(Effect.catch((error) => Effect.succeed(`failed: ${plain(failed(error), 300)}`)));
      lines.push(`${id} ${item.kind}: ${done}.`);
    }
    plans.delete(session.id);
    return lines.length === 0 ? "No items given; nothing changed." : lines.join("\n");
  });
}

export const briefCommand = (services: Services): PeerCommand => ({
  name: "brief",
  usage: USAGE,
  waitSeconds: 60,
  summary:
    "plan updating this project's task briefs from OpenSpec, then apply the items your person confirms",
  run: ({ session, args, flag }): Effect.Effect<string, CliError> => {
    const [form, ...rest] = args;
    const run =
      form === "plan"
        ? plan(services, session, flag("--repository"))
        : form === "apply"
          ? apply(
              services,
              session,
              rest.filter((word) => !word.startsWith("--")),
            )
          : Effect.fail(usage(`peer ${USAGE}`, "run peer brief plan first."));
    return run.pipe(
      Effect.catch((error) =>
        Effect.fail(
          "outcome" in (error as object)
            ? (error as CliError)
            : refused(failed(error), "check the task in Peer, then make a new plan."),
        ),
      ),
    );
  },
});

const ITEM = /^b\d{1,3}$/;
export const briefTools: ReadonlyArray<PeerAgentTool> = [
  {
    name: "peer_brief",
    description:
      "Update this project's Peer tasks from the repository's current OpenSpec changes. action plan compares every open task's saved brief with OpenSpec and lists what would change (link, refresh, relink, unlink, close, create) without changing anything; show it to your person. action apply with items applies only the item ids your person confirmed. Nothing is deleted, and a task whose brief is unlinked stays startable on its own.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["plan", "apply"] },
        repository: { type: "string" },
        items: { type: "array", items: { type: "string", pattern: ITEM.source }, maxItems: 100 },
      },
      required: ["action"],
      additionalProperties: false,
    },
    command: "brief",
    arguments: (input) => {
      const wrong = () =>
        usage("invalid arguments for peer_brief", "check the peer_brief tool schema.");
      const { action, repository, items } = input;
      if (action === "plan") {
        if (items !== undefined) throw wrong();
        if (repository === undefined) return ["plan"];
        if (typeof repository !== "string" || !/^[\w.-]{1,200}$/.test(repository)) throw wrong();
        return ["plan", "--repository", repository];
      }
      if (action !== "apply" || repository !== undefined) throw wrong();
      if (
        !Array.isArray(items) ||
        items.some((item) => typeof item !== "string" || !ITEM.test(item))
      )
        throw wrong();
      return ["apply", ...(items as ReadonlyArray<string>)];
    },
  },
];
