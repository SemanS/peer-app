/**
 * What Peer Core's one-shot commands share: where they write their lines, how they ask for a code,
 * and their failures as the CLI prints them.
 *
 * @module cli/peerCoreIo
 */
import type { PeerHubError } from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import * as Runtime from "effect/Runtime";
import * as CliError from "effect/cli/CliError";

import { type CliOutcome, EXIT_STATUS } from "../peerHub/core/broker/cliContract.ts";

export const fail = (text: string) => new CliError.UserError({ cause: text, userMessage: text });

/** Where a one-shot command writes its lines, and how it asks for a mailed code. */
export interface OneShotIo {
  readonly say: (line: string) => Effect.Effect<void>;
  readonly askCode: Effect.Effect<string, CliError.UserError>;
}

const sentence = (reason: string) => (/[.!?]$/.test(reason) ? reason : `${reason}.`);

/**
 * A one-shot command's end as the peer-cli-contract words it (`peer core: refused: … / Next: …`),
 * exiting with the contract's status: 2 usage, 3 refused, 4 uncertain.
 */
export const outcome = (kind: CliOutcome, reason: string, next: string) => {
  const text = `peer core: ${kind}: ${sentence(reason)}\nNext: ${next}`;
  return Object.assign(new CliError.UserError({ cause: text, userMessage: text }), {
    [Runtime.errorExitCode]: EXIT_STATUS[kind],
  });
};

const SIGN_IN =
  "sign in with peer core login <email>, or join with your invitation link, then repeat the command.";

/**
 * A Hub failure of `command`: refused when the Hub said so (or for a read, which changed nothing),
 * else uncertain, since a write may have reached the Hub.
 */
export const hubOutcome = (
  error: PeerHubError,
  command: string,
  next: string,
  read: boolean,
): CliError.UserError => {
  if (error.kind === "signedOut" || error.detail === "Sign in first.")
    return outcome("refused", error.detail, SIGN_IN);
  if (read || error.refused === true) return outcome("refused", error.detail, next);
  return outcome(
    "uncertain",
    `the Hub gave no usable answer (${error.detail.replace(/\.$/, "")}), so peer core ${command} may or may not have taken effect`,
    next,
  );
};
