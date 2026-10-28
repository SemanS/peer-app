/**
 * What Peer Core's one-shot commands share: where they write their lines, how they ask for a code,
 * and their failures as the CLI prints them.
 *
 * @module cli/peerCoreIo
 */
import type * as Effect from "effect/Effect";
import * as CliError from "effect/cli/CliError";

export const fail = (text: string) => new CliError.UserError({ cause: text, userMessage: text });

/** Where a one-shot command writes its lines, and how it asks for a mailed code. */
export interface OneShotIo {
  readonly say: (line: string) => Effect.Effect<void>;
  readonly askCode: Effect.Effect<string, CliError.UserError>;
}
