/**
 * `peer follow`: build on another task's change, go back to trunk, or see what the work builds on.
 * It moves only the session's own changes, and never fetches outside the tool step it runs in.
 *
 * @module peerHub/plugins/jujutsu/cli
 */
import * as Effect from "effect/Effect";

import { CliError, usage, type PeerCommand } from "../../core/plugin.ts";
import type { Jujutsu } from "./Jujutsu.ts";

const NEXT = "run peer follow ORD-11, or peer follow --stop";

export const followCommand = (jujutsu: Jujutsu["Service"]): PeerCommand => ({
  name: "follow",
  usage: "follow [<task>] [--stop]",
  summary: "build on another task's change",
  run: ({ session, args, plain }) => {
    const stop = args[0] === "--stop";
    if (args.length > 1 || (args.length === 1 && !stop && plain.length !== 1))
      return Effect.fail(usage("peer follow takes a task, or --stop", NEXT));
    if (args.length === 0) return jujutsu.followStatus(session);
    return jujutsu.followNow(session, { task: stop ? undefined : args[0], stop }).pipe(
      Effect.map((done) =>
        [
          done.onto
            ? `Your change ${done.change} now builds on ${done.onto} (${done.label}).`
            : `Your change ${done.change} now builds on trunk.`,
          ...done.output,
          ...(done.conflicts.length === 0
            ? []
            : [
                `It holds a conflict in ${done.conflicts.slice(0, 3).join(", ")}, stored in your change. Those lines are not yours: keep your edits in your own change.`,
              ]),
          done.onto
            ? `Peer moves it along each time ${done.person} changes ${done.onto}. Stop with: peer follow --stop`
            : "Peer no longer moves it along with another task's change.",
        ].join("\n"),
      ),
      Effect.mapError((error) =>
        error instanceof CliError ? error : usage("peer follow failed", NEXT),
      ),
    );
  },
});
