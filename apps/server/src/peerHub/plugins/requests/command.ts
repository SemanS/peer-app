// @effect-diagnostics nodeBuiltinImport:off - a request's operation id is a hash of what it asks.
/**
 * `peer request`: an agent puts a durable request in a teammate's Needs you, for its own project
 * and task. The same request from the same session has the same operation id, so a retried command
 * asks once.
 *
 * @module peerHub/plugins/requests/command
 */
import * as NodeCrypto from "node:crypto";

import type { PeerHubError, PeerHubSendRequestInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { hubFailure, usage, type PeerCommand, type PeerSessionView } from "../../core/plugin.ts";
import { clip } from "../../peerText.ts";

const USAGE = 'request <email> "<prompt>" [--title "<title>"] [--op <stable-id>]';
const MAX_PROMPT = 20_000;

/** What names this request among all a session could send: the same ask is the same operation. */
function operationOf(
  session: PeerSessionView,
  recipient: string,
  title: string,
  prompt: string,
): string {
  const asked = JSON.stringify([session.id, recipient, title, prompt, session.task]);
  return `request-${NodeCrypto.createHash("sha256").update(asked).digest("hex").slice(0, 32)}`;
}

/** The command, sending through `send` (`Requests.send`). */
export const requestCommand = (
  send: (input: PeerHubSendRequestInput) => Effect.Effect<unknown, PeerHubError>,
): PeerCommand => ({
  name: "request",
  usage: USAGE,
  summary: "a durable request in a teammate's Needs you; they choose whether to start their agent",
  run: ({ session, plain, flag }) =>
    Effect.gen(function* () {
      const recipient = plain[0];
      const prompt = plain.slice(1).join(" ").trim();
      if (recipient === undefined || prompt === "" || prompt.length > MAX_PROMPT) {
        return yield* Effect.fail(
          usage(`use peer ${USAGE}, up to ${MAX_PROMPT} characters`, `run peer ${USAGE}.`),
        );
      }
      const title = flag("--title") ?? clip(prompt.split("\n")[0] ?? prompt, 120);
      const op = flag("--op") ?? operationOf(session, recipient, title, prompt);
      yield* send({
        workspace: session.workspace,
        projectId: session.project,
        recipient,
        prompt,
        title,
        op,
        ...(session.task === undefined ? {} : { task: session.task }),
      }).pipe(
        Effect.tapError((error) =>
          Effect.logWarning("peer request could not send its request", { detail: error.detail }),
        ),
        Effect.mapError((error) =>
          hubFailure(
            error,
            "request",
            "repeat the same command once the requirement is met; its operation id prevents a duplicate.",
          ),
        ),
      );
      return `Request sent to ${recipient}. It is in their Needs you and waits for their acceptance. Operation: ${op}.`;
    }),
});
