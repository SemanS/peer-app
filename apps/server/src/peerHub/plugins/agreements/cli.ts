/**
 * `peer agreements`: the agreements kept for the session's task, those not closed first, then those
 * closed in the last 14 days, each with the other task, who settled it and when, how it stands and
 * its words fenced as teammate text. Without a session (a person's terminal in a checkout) it prints
 * the project's open agreements and records nothing. It only reads: a Hub that does not answer ends
 * it refused, as it does every read command.
 *
 * @module peerHub/plugins/agreements/cli
 */
import { CliError, hubFailure, usage, type PeerCommand } from "../../core/plugin.ts";
import * as Effect from "effect/Effect";

import type { Agreements } from "./Agreements.ts";

const RETRY = "run peer agreements again when the Hub is reachable.";

export const agreementsCommand = (agreements: Agreements["Service"]): PeerCommand => ({
  name: "agreements",
  usage: "agreements",
  summary: "what the agents of your task and another task agreed: open, due, recently closed",
  public: true,
  run: ({ session, args }) =>
    args.length > 0
      ? Effect.fail(usage("peer agreements takes no arguments", "run peer agreements."))
      : agreements
          .show(session)
          .pipe(
            Effect.mapError((error) =>
              error instanceof CliError ? error : hubFailure(error, "agreements", RETRY, true),
            ),
          ),
});
