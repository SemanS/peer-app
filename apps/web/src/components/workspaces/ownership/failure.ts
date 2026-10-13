import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { PeerHubError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const isPeerHubError = Schema.is(PeerHubError);

/**
 * What a refused or failed ownership change says, for the dialog or card that asked: the Hub's own
 * words (a refusal names why: "only a lead or an admin names an owner"), except for a call that is
 * no longer pending, which every client says the same way. Null when it did not fail, or the person
 * interrupted it.
 */
export function ownershipFailure(result: AtomCommandResult<unknown, unknown>): string | null {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
  const cause = squashAtomCommandFailure(result);
  if (isPeerHubError(cause) && cause.code === "owner_call_closed") {
    return "This call is no longer pending.";
  }
  return cause instanceof Error ? cause.message : String(cause);
}
