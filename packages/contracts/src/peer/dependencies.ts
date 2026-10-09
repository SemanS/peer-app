import * as Schema from "effect/Schema";
import type { PeerTask, PeerWorkThread } from "./base.ts";
export const PeerDependencyState = Schema.Literals(["open", "review", "merged", "done"]);
export type PeerDependencyState = typeof PeerDependencyState.Type;
export const PeerDependencyProjects = Schema.Record(
  Schema.String,
  Schema.Record(Schema.String, Schema.Array(Schema.String)),
);
export const PeerDependencySnapshot = Schema.Struct({
  workspace: Schema.String,
  available: Schema.Boolean,
  projects: PeerDependencyProjects,
});
export type PeerDependencySnapshot = typeof PeerDependencySnapshot.Type;
export const PeerDependencyChangeInput = Schema.Struct({
  workspace: Schema.String,
  projectId: Schema.String,
  taskId: Schema.String,
  add: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(32))),
  remove: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(32))),
});
export type PeerDependencyChangeInput = typeof PeerDependencyChangeInput.Type;
export const PeerDependencyChangeResult = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("changed"),
    changed: Schema.Boolean,
    dependsOn: Schema.Array(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("cycle"), path: Schema.Array(Schema.String) }),
]);
export type PeerDependencyChangeResult = typeof PeerDependencyChangeResult.Type;
/** A person's close wins; every recorded thread must confirm delivery to call work merged. */
export function dependencyState(
  task: Pick<PeerTask, "status">,
  threads: ReadonlyArray<Pick<PeerWorkThread, "delivery">>,
): PeerDependencyState {
  if (task.status === "done") return "done";
  if (threads.length > 0 && threads.every((thread) => thread.delivery === "merged"))
    return "merged";
  return task.status === "review" ? "review" : "open";
}
