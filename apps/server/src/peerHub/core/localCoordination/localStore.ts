import { PeerCoordEvent, PeerOverlapRecord } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const Operation = Schema.Struct({
  key: Schema.String,
  input: Schema.String,
  result: Schema.String,
});

type LocalState = {
  readonly overlaps: ReadonlyArray<PeerOverlapRecord>;
  readonly events: ReadonlyArray<PeerCoordEvent>;
  readonly operations: ReadonlyArray<typeof Operation.Type>;
};

/**
 * What `local-state.json` holds. A file from before this shape loads as it is: what it holds
 * besides is ignored, and whatever is missing is empty.
 */
const decode = Schema.decodeUnknownSync(
  Schema.Struct({
    overlaps: Schema.optional(Schema.Array(PeerOverlapRecord)),
    events: Schema.optional(Schema.Array(PeerCoordEvent)),
    operations: Schema.optional(Schema.Array(Operation)),
  }),
);

export const empty = (): LocalState => ({ overlaps: [], events: [], operations: [] });

export const decodeStored = (value: unknown): LocalState => {
  const { overlaps = [], events = [], operations = [] } = decode(value);
  return { overlaps, events, operations };
};
