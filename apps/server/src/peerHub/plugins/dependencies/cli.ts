import * as Effect from "effect/Effect";
import type { PeerCommandInput } from "../../core/plugin.ts";
import { hubFailure, refused, usage } from "../../core/plugin.ts";
import type * as PeerWork from "../../core/work/PeerWork.ts";
import type * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import type { Dependencies } from "./service.ts";
import { listText, stateWord } from "./text.ts";
export const dependsCli =
  (
    service: Dependencies["Service"],
    work: PeerWork.PeerWork["Service"],
    agents: PeerAgents.PeerAgents["Service"],
  ) =>
  ({ session, args }: PeerCommandInput) =>
    Effect.gen(function* () {
      const removing = args[0] === "--remove",
        names = removing ? args.slice(1) : args;
      if (names.some((name) => name.startsWith("--")) || (removing && !names.length))
        return yield* Effect.fail(
          usage("peer depends [--remove] <task>...", "Run peer depends to list both directions."),
        );
      if (!session.task)
        return yield* Effect.fail(
          refused(
            "this session must be on a task",
            "Ask your person to assign this thread to a task.",
          ),
        );
      yield* agents.sync(session.workspace, 3000);
      yield* service.refresh(session.workspace);
      const snapshot = (yield* service.snapshot).find((s) => s.workspace === session.workspace);
      if (!snapshot?.available)
        return yield* Effect.fail(
          refused(
            "this Peer Hub cannot record dependencies",
            "Ask your person to update the Peer Hub.",
          ),
        );
      const tasks = yield* work.tasks(session.workspace, session.project),
        own = tasks.find((t) => t.id === session.task),
        ownName = own?.key ?? session.task;
      if (!names.length) {
        const facts = yield* service.facts(session);
        return listText(ownName, facts.on, facts.needed);
      }
      const found = [];
      for (const name of names) {
        const task = tasks.find(
          (t) =>
            t.id.toLowerCase() === name.toLowerCase() ||
            t.key?.toLowerCase() === name.toLowerCase(),
        );
        if (!task)
          return yield* Effect.fail(
            refused(
              `no task "${name}" on ${session.project}`,
              "Run peer index for task names, then retry.",
            ),
          );
        found.push(task);
      }
      const before = snapshot.projects[session.project]?.[session.task] ?? [];
      const result = yield* service
        .change({
          workspace: session.workspace,
          projectId: session.project,
          taskId: session.task,
          ...(removing ? { remove: found.map((t) => t.id) } : { add: found.map((t) => t.id) }),
        })
        .pipe(
          Effect.mapError((error) =>
            hubFailure(
              error,
              "depends",
              "Run peer depends to see whether it changed; repeating the same add or remove is safe.",
            ),
          ),
        );
      if (result.kind === "cycle")
        return yield* Effect.fail(
          refused(
            `a cycle cannot be recorded (${result.path.map((id) => tasks.find((t) => t.id === id)?.key ?? id).join(" → ")})`,
            "Remove an existing dependency first, then retry.",
          ),
        );
      const facts = yield* service.facts(session);
      yield* service.acknowledge(session);
      return found
        .map((task) =>
          removing
            ? `${ownName} ${before.includes(task.id) ? "no longer depends on" : "did not depend on"} ${task.key ?? task.id}.`
            : `${ownName} now depends on ${task.key ?? task.id} (${stateWord(facts.on.find((f) => f.id === task.id)?.state ?? "open")}). Peer tells you once when that changes and never holds your work for it.`,
        )
        .join("\n");
    });
