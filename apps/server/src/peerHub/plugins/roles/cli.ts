/**
 * `peer role`: the session's role; `peer role review` makes it a review session while it has
 * changed nothing and claims nothing (the Hub checks the same on its row); `peer role none` is
 * refused, since an agent that could drop its own role would make the deny meaningless: its person
 * clears it in Peer. Outcomes follow the peer-cli-contract: not applied is refused, may have been is
 * uncertain, a wrong line is usage.
 *
 * @module peerHub/plugins/roles/cli
 */
import type { PeerHubError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  CliError,
  isSignedOut,
  refused,
  usage,
  type PeerCommand,
  type PeerSessionView,
} from "../../core/plugin.ts";
import type * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import type { Roles } from "./Roles.ts";
import { pathsText, roleText, tookText } from "./text.ts";

const FORM = "peer role | peer role review";
const FRESH =
  "start a new session for the review: a session takes the role review before it changes anything.";

/** What the Hub's refusal of the role means to the agent; no answer leaves it uncertain. */
function takeFailure(error: PeerHubError): CliError {
  if (isSignedOut(error))
    return refused(error.detail, "ask your person to sign in to Peer, then repeat the command.");
  if (error.code === "session_not_clean")
    return refused("the Hub says this session already changed files or holds claims", FRESH);
  if (error.code === "not_your_session")
    return refused(
      error.detail,
      "run peer role review again in a moment: Peer reports your session to the Hub first.",
    );
  if (error.refused === true)
    return refused(error.detail, "tell your person; repeating this command will not help.");
  return new CliError(
    "uncertain",
    "the Hub did not answer, so the role may or may not be on the Hub; Peer denies this session's edits and landing steps meanwhile",
    "peer role",
  );
}

/** `peer role`, through the service, logging the roles set. */
export const roleCommand = (
  roles: Roles["Service"],
  agents: PeerAgents.PeerAgents["Service"],
  person: (session: PeerSessionView) => string,
): PeerCommand => ({
  name: "role",
  usage: "role | role review",
  summary: "your session's role; review makes it a review session, before it changes anything",
  run: ({ session, args, plain }) =>
    Effect.gen(function* () {
      const [verb, ...rest] = plain;
      if (args.some((arg) => arg.startsWith("--")) || rest.length > 0)
        return yield* Effect.fail(usage("peer role takes one word at most", FORM));
      if (session.public === true)
        return yield* Effect.fail(
          refused(
            "this call does not come from an agent session, so Peer cannot tell whose role it is",
            "run peer from the shell of an agent session. A person sets a role in Peer: Start a review on a task, or the thread's header.",
          ),
        );
      const role = roles.roleOf(session);
      if (verb === undefined) return roleText(role);
      if (verb === "none" || verb === "clear")
        return yield* Effect.fail(
          refused(
            "an agent cannot clear or change its own role",
            `ask ${person(session)} to clear it in Peer, in the thread's header (Clear role).`,
          ),
        );
      if (verb !== "review")
        return yield* Effect.fail(usage(`there is no role ${verb.slice(0, 40)}`, FORM));
      if (role === "review") return "This session already reviews (role review).";
      if (session.files.length > 0 || session.claims.length > 0)
        return yield* Effect.fail(
          refused(
            session.files.length > 0
              ? `this session already changed ${pathsText(session.files)}`
              : `this session holds claims on ${pathsText(session.claims)}`,
            FRESH,
          ),
        );
      yield* roles.take(session, "review").pipe(
        Effect.mapError(takeFailure),
        Effect.tapError((error) =>
          agents.log("roles.set", { session: session.id, by: "agent", outcome: error.outcome }),
        ),
      );
      yield* agents.log("roles.set", { session: session.id, by: "agent", outcome: "done" });
      return tookText;
    }),
});
