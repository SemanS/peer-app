import {
  PeerDependencyProjects,
  PeerHubError,
  type PeerDependencyChangeInput,
  type PeerDependencyChangeResult,
  type PeerDependencySnapshot,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import type * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
const Read = Schema.Struct({ projects: PeerDependencyProjects });
const Changed = Schema.Struct({
  task: Schema.String,
  dependsOn: Schema.Array(Schema.String),
  changed: Schema.Boolean,
});
const cycle = Schema.decodeUnknownOption(Schema.Struct({ path: Schema.Array(Schema.String) }));
export function hubClient(client: PeerHubClient.PeerHubClient["Service"]) {
  const unsupported = {
    value: null,
    when: (_status: number, message: string) => message === "no such route",
  };
  return {
    read: (workspace: string): Effect.Effect<PeerDependencySnapshot, PeerHubError> =>
      client.request(Read, { workspace, path: "/dependencies", unsupported }).pipe(
        Effect.map((answer) => ({
          workspace,
          available: answer !== null,
          projects: answer?.projects ?? {},
        })),
      ),
    change: (
      input: PeerDependencyChangeInput,
    ): Effect.Effect<PeerDependencyChangeResult, PeerHubError> =>
      client
        .request(Changed, {
          workspace: input.workspace,
          method: "PATCH",
          path: `/projects/${encodeURIComponent(input.projectId)}/tasks/${encodeURIComponent(input.taskId)}/dependencies`,
          body: { add: input.add ?? [], remove: input.remove ?? [] },
          unsupported,
          conflict: (code, details) => {
            const parsed = cycle(details);
            return code === "dependency_cycle" && parsed._tag === "Some"
              ? { kind: "cycle" as const, path: parsed.value.path }
              : undefined;
          },
        })
        .pipe(
          Effect.flatMap((answer) =>
            answer === null
              ? Effect.fail(
                  new PeerHubError({
                    detail: "This Peer Hub cannot record dependencies.",
                    refused: true,
                  }),
                )
              : Effect.succeed(
                  "kind" in answer
                    ? answer
                    : {
                        kind: "changed" as const,
                        changed: answer.changed,
                        dependsOn: answer.dependsOn,
                      },
                ),
          ),
        ),
  };
}
