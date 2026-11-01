import { PeerCoordEvent } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/**
 * What `local-state.json` holds: the project's history. A file from before this shape loads as it
 * is: what it holds besides is ignored, and whatever is missing is empty.
 */
const Stored = Schema.Struct({ events: Schema.optional(Schema.Array(PeerCoordEvent)) });
const decode = Schema.decodeUnknownSync(Stored);

export const empty = (): { readonly events: ReadonlyArray<PeerCoordEvent> } => ({ events: [] });

export const decodeStored = (value: unknown) => ({ events: decode(value).events ?? [] });
