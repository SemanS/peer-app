/**
 * What the Hub's refusals of an owner's call mean to the `peer` command that asked for it, by the
 * codes the Hub gives them (`server/src/features/ownership/api.rs`): a call the Hub did not apply is
 * refused (with the next step), what no answer came of is uncertain, and a command line the Hub
 * found wrong is a usage error.
 *
 * @module peerHub/plugins/ownership/client/failures
 */
import type { PeerHubError } from "@t3tools/contracts";

import { CliError, isSignedOut, refused, usage } from "../../../core/plugin.ts";

const NEXT: Readonly<Record<string, string>> = {
  not_your_session:
    "run the command again in a moment: Peer reports your session to the Hub first.",
  not_found: "run peer owner to see your calls.",
  owner_call_closed: "run peer owner to see how it ended.",
  too_many_calls: "withdraw one with peer owner withdraw <id>, or wait for an answer.",
  owner_full: "wait for their calls to be answered, then ask again.",
  ownership_forbidden: "tell your person; repeating this command will not help.",
};

/** How the Hub's failure to open (`ask`) or take back (`withdraw`) a call ends the command. */
export function callFailure(error: PeerHubError, what: "ask" | "withdraw", form: string): CliError {
  if (isSignedOut(error))
    return refused(error.detail, "ask your person to sign in to Peer, then repeat the command.");
  if (error.status === 400) return usage(error.detail, form);
  const next = NEXT[error.code ?? ""];
  if (next !== undefined) return refused(error.detail, next);
  if (error.refused === true)
    return refused(error.detail, "tell your person; repeating this command will not help.");
  return new CliError(
    "uncertain",
    `the Hub did not answer, so the call may or may not have been ${what === "ask" ? "opened" : "withdrawn"}`,
    "peer owner",
  );
}
