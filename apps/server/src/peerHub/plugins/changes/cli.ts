/**
 * `peer changes`: the project's changes in flight as an index, in at most 1,500 characters: each
 * change's id, task, subject, person and agent, its files, and whether it is read-only to the
 * session or the session's work builds on it, then the commands to read more. It only reads: a Hub
 * that does not answer ends it refused, as it does every read command.
 *
 * @module peerHub/plugins/changes/cli
 */
import { CliError, hubFailure, usage, type PeerCommand } from "../../core/plugin.ts";
import * as Effect from "effect/Effect";

import type { Changes } from "./Changes.ts";

const RETRY = "run peer changes again when the Hub is reachable.";

export const changesCommand = (changes: Changes["Service"]): PeerCommand => ({
  name: "changes",
  usage: "changes",
  summary: "everyone's jj changes in flight in this project, to read one when you choose",
  public: true,
  run: ({ session, args }) =>
    args.length > 0
      ? Effect.fail(usage("peer changes takes no arguments", "run peer changes."))
      : changes
          .show(session)
          .pipe(
            Effect.mapError((error) =>
              error instanceof CliError ? error : hubFailure(error, "changes", RETRY, true),
            ),
          ),
});
