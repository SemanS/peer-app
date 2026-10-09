import * as Effect from "effect/Effect";
import { type PeerCommand, refused, usage, hubFailure, CliError } from "../../core/plugin.ts";
import type * as PeerWork from "../../core/work/PeerWork.ts";
import type * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import type { HandoffService } from "./service.ts";
import { agentText, replyLines } from "./render.ts";
export const handoffCommand = (
  work: PeerWork.PeerWork["Service"],
  agents: PeerAgents.PeerAgents["Service"],
  service: HandoffService["Service"],
): PeerCommand => ({
  name: "handoff",
  usage: "handoff [<task>] | withdraw",
  summary: "the task's handoff package (reference), or remove yours",
  run: ({ session, args }) =>
    Effect.gen(function* () {
      if (args.length > 1)
        return yield* Effect.fail(
          usage(
            "handoff takes at most one task or withdraw",
            "run peer handoff [task] or peer handoff withdraw.",
          ),
        );
      const handle = args[0];
      const tasks = yield* work.tasks(session.workspace, session.project);
      const task =
        handle && handle !== "withdraw"
          ? tasks.find(
              (t) =>
                t.id.toLowerCase() === handle.toLowerCase() ||
                t.key?.toLowerCase() === handle.toLowerCase(),
            )
          : tasks.find((t) => t.id === session.task);
      if (!task)
        return yield* Effect.fail(
          refused("no such task", "run peer index for task names, then peer handoff <task>."),
        );
      const p = {
        workspace: session.workspace,
        projectId: session.project,
        taskId: task.id,
      };
      if (handle === "withdraw") return replyLines(yield* service.withdraw(p)).join("\n");
      const context = (yield* agents.hubViews)
        .find((v) => v.workspace === session.workspace)
        ?.view.contexts?.find(
          (c) => c.project === session.project && c.scope === `task:${task.id}`,
        );
      return agentText(yield* service.read(p), context?.version ?? null);
    }).pipe(
      Effect.mapError((e) =>
        e instanceof CliError ? e : hubFailure(e, "handoff", "run peer handoff again."),
      ),
    ),
});
