import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "../baseSchemas.ts";

export const PEER_OPENSPEC_PLUGIN = {
  id: "openspec",
  title: "OpenSpec",
  summary: "Read a task's current OpenSpec change and prepare its agent prompt.",
  defaultEnabled: true,
} as const;

const Identifier = TrimmedNonEmptyString.check(Schema.isMaxLength(200));

export const PeerOpenSpecReadInput = Schema.Struct({
  workspace: Identifier,
  projectId: Identifier,
  taskId: Identifier,
  repositoryId: Schema.optional(Identifier),
});
export type PeerOpenSpecReadInput = typeof PeerOpenSpecReadInput.Type;

export const PeerOpenSpecReadResult = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("ready"),
    repositoryId: Schema.String,
    changeId: Schema.String,
    sourcePath: Schema.String,
    proposal: Schema.String,
    tasks: Schema.String,
    design: Schema.NullOr(Schema.String),
    prompt: Schema.String.check(Schema.isMaxLength(20_000)),
    completed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    total: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    code: Schema.Literals(["not-linked", "source-unavailable"]),
    reason: Schema.String,
  }),
]);
export type PeerOpenSpecReadResult = typeof PeerOpenSpecReadResult.Type;
