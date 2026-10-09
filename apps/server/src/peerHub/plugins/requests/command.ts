// @effect-diagnostics nodeBuiltinImport:off - a request's operation id is a hash of what it asks.
/**
 * `peer request`: an agent puts a durable request in a teammate's Needs you, for its own project
 * and task. The same request from the same session has the same operation id, so a retried command
 * asks once.
 *
 * @module peerHub/plugins/requests/command
 */
import * as NodeCrypto from "node:crypto";

import type {
  PeerHubError,
  PeerHubSendRequestInput,
  PeerHubWithdrawRequestInput,
  PeerAgentRequest,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  refused,
  uncertain,
  usage,
  type PeerCommand,
  type PeerSessionView,
  isSignedOut,
} from "../../core/plugin.ts";
import { clip } from "../../peerText.ts";

import {
  REQUEST_USAGE as USAGE,
  refusedNext,
  uncertainNext,
  sentText,
  listText,
  withdrawnText,
} from "./text.ts";
const MAX_PROMPT = 20_000;
const signInNext = "Ask your person to sign in to Peer, then repeat the command.";

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

/** Each transport uses the same typed service; reads never print teammate text. */
export const requestCommand = (requests: {
  readonly send: (input: PeerHubSendRequestInput) => Effect.Effect<PeerAgentRequest, PeerHubError>;
  readonly list: (
    workspace: string,
  ) => Effect.Effect<ReadonlyArray<PeerAgentRequest>, PeerHubError>;
  readonly withdraw: (
    input: PeerHubWithdrawRequestInput,
  ) => Effect.Effect<PeerAgentRequest, PeerHubError>;
}): PeerCommand => ({
  name: "request",
  usage: USAGE,
  waitSeconds: 30,
  summary: "a durable request in a teammate's Needs you; they choose whether to start their agent",
  run: ({ session, plain, args, flag }) =>
    Effect.gen(function* () {
      const invalid = () => usage(`use peer ${USAGE}`, `run peer request --help.`);
      const flags = new Set<string>();
      for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (!arg.startsWith("--")) continue;
        if (
          (arg !== "--op" && arg !== "--title") ||
          flags.has(arg) ||
          !args[i + 1] ||
          args[i + 1]!.startsWith("--")
        )
          return yield* Effect.fail(invalid());
        flags.add(arg);
        i++;
      }
      if (plain[0] === "list") {
        if (plain.length !== 1 || flags.size > 0) return yield* Effect.fail(invalid());
        const rows = yield* requests
          .list(session.workspace)
          .pipe(
            Effect.mapError((error) =>
              refused(
                error.detail,
                isSignedOut(error)
                  ? signInNext
                  : "retry peer request list when the Hub is reachable.",
              ),
            ),
          );
        const own = rows.filter((row) => row.project === session.project);
        own.sort(
          (a, b) =>
            Number(b.status === "pending") - Number(a.status === "pending") ||
            b.updatedAt.localeCompare(a.updatedAt),
        );
        return listText(session.project, own);
      }
      if (plain[0] === "withdraw") {
        if (plain.length !== 2 || flags.size > 0) return yield* Effect.fail(invalid());
        const id = plain[1]!;
        const row = yield* requests
          .withdraw({ workspace: session.workspace, projectId: session.project, requestId: id })
          .pipe(
            Effect.mapError((error) =>
              isSignedOut(error) || error.refused === true
                ? refused(error.detail, isSignedOut(error) ? signInNext : refusedNext)
                : uncertain(
                    "request withdraw",
                    error.detail,
                    `Repeat peer request withdraw ${id}; withdrawing the same request twice is safe.`,
                  ),
            ),
          );
        return withdrawnText(row);
      }
      const recipient = plain[0],
        prompt = plain.slice(1).join(" ").trim();
      if (
        recipient === undefined ||
        !/^[^\s@]+@[^\s@]+$/.test(recipient) ||
        recipient.length > 180 ||
        prompt === "" ||
        prompt.length > MAX_PROMPT
      )
        return yield* Effect.fail(invalid());
      const title = (flag("--title") ?? clip(prompt.split("\n")[0] ?? prompt, 120)).trim();
      if (title === "" || title.length > 120)
        return yield* Effect.fail(
          usage(
            "a request title is 1 to 120 characters",
            `shorten --title, then repeat the command.`,
          ),
        );
      const op = flag("--op") ?? operationOf(session, recipient, title, prompt);
      if (op.length > 48 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(op))
        return yield* Effect.fail(
          usage(
            "an operation id is lowercase letters, digits and dashes, up to 48 characters",
            "use a valid --op, then repeat the command.",
          ),
        );
      const row = yield* requests
        .send({
          workspace: session.workspace,
          projectId: session.project,
          recipient,
          prompt,
          title,
          op,
          ...(session.task === undefined ? {} : { task: session.task }),
        })
        .pipe(
          Effect.mapError((error) =>
            error.refused === true || isSignedOut(error)
              ? refused(error.detail, isSignedOut(error) ? signInNext : refusedNext)
              : uncertain("request", error.detail, uncertainNext(op)),
          ),
        );
      return sentText(row, op);
    }),
});
