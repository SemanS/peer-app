import { PeerCoordEvent, PeerOverlapRecord, PeerContextRead } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { LocalStateStorage } from "./LocalStateStorage.ts";
import { HubContextText, HubContextVersionText, HubFinding } from "../hub/coordApi.ts";

const Stored = Schema.Struct({
  version: Schema.Literals([1, 2]),
  reads: Schema.optional(Schema.Array(PeerContextRead)),
  manifests: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        status: Schema.Literals(["complete", "revalidation-required", "unavailable"]),
        pendingScopes: Schema.Array(Schema.String),
        requiredScopes: Schema.Array(Schema.String),
        baselineIncomplete: Schema.optional(Schema.Boolean),
        reason: Schema.optional(Schema.String),
        coverage: Schema.optional(
          Schema.Literals(["reconstructed", "new-work", "transferred", "unavailable"]),
        ),
        at: Schema.optional(Schema.String),
      }),
    ),
  ),
  legacyEvidenceLost: Schema.optional(Schema.Boolean),
  overlaps: Schema.Array(PeerOverlapRecord),
  contexts: Schema.Record(Schema.String, HubContextText),
  versions: Schema.Record(Schema.String, Schema.Array(HubContextVersionText)),
  findings: Schema.Array(HubFinding),
  events: Schema.Array(PeerCoordEvent),
  operations: Schema.Array(
    Schema.Struct({ key: Schema.String, input: Schema.String, result: Schema.String }),
  ),
});
export const decodeStored = Schema.decodeUnknownSync(Stored);
type Stored = typeof Stored.Type;
export const empty = (): Stored => ({
  version: 2,
  reads: [],
  manifests: {},
  legacyEvidenceLost: false,
  overlaps: [],
  contexts: {},
  versions: {},
  findings: [],
  events: [],
  operations: [],
});

export const readLocalStoredState = (file: string) =>
  new LocalStateStorage(file).load(decodeStored);
