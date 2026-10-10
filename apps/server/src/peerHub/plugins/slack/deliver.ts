/**
 * deliver — takes the owner's answers from Slack to the exact decision point they answer, and only
 * to it. Each answer is checked again against what is open now; one to a decision point that is
 * over is delivered nowhere and reported stale. What became of it is written down before the Hub is
 * told, so a crash in between reports it again and delivers nothing twice.
 *
 * @module peerHub/plugins/slack/deliver
 */
import { CommandId, MessageId, RuntimeRequestId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { SlackAnswer } from "./hub.ts";
import type { Outcome } from "./ledger.ts";
import type { Slack } from "./publisher.ts";
import type { SlackThreads, Source } from "./world.ts";

type Verdict = Omit<Outcome, "workspace">;
const sent: Verdict = { result: "delivered" };
const refuse = (result: "failed" | "stale", reason: string): Verdict => ({ result, reason });

/** What the answer does to the decision point it answers, or undefined if Slack cannot do that. */
function delivery(s: Slack, threads: SlackThreads, { wait, ...from }: Source, answer: SlackAnswer) {
  const text = answer.value.trim();
  const id = `slack:${answer.answer}`;
  const done = <E>(run: Effect.Effect<unknown, E>) =>
    run.pipe(
      Effect.as(sent),
      Effect.orElseSucceed(() => refuse("failed", "error")),
    );
  if ("agent" in from) {
    const { id: agent, session, turn } = from.agent.agent;
    if (wait.kind !== "finished" || answer.kind !== "text") return undefined;
    if (session === undefined || turn === undefined) return undefined;
    // The agent is typed into only if it is still that session at that turn.
    return s.agents.promptRuntime(agent, text, { session, turn }).pipe(
      Effect.as(sent),
      Effect.catch((error) =>
        Effect.succeed(
          error._tag === "PeerPromptStale"
            ? refuse("stale", error.reason === "gone" ? "ended" : "moved-on")
            : refuse("failed", "error"),
        ),
      ),
    );
  }
  const { shell, request } = from.thread;
  if (wait.kind === "finished") {
    const message = {
      projectId: shell.projectId,
      threadId: shell.id,
      commandId: CommandId.make(id),
      messageId: MessageId.make(id),
      text,
      attachments: [],
      mode: "auto",
      createdBy: "user",
      creationSource: "server",
    } as const;
    return answer.kind === "text" ? done(threads.sendToThread(message)) : undefined;
  }
  if (request === undefined) return undefined;
  const respond = (
    reply: { decision: "accept" | "decline" } | { answers: Record<string, string> },
  ) =>
    done(
      threads.dispatch({
        type: "runtime-request.respond",
        commandId: CommandId.make(id),
        threadId: shell.id,
        requestId: RuntimeRequestId.make(request.requestId),
        ...reply,
      }),
    );
  if (request.kind === "approval") {
    const { value } = answer;
    return answer.kind === "decision" && (value === "accept" || value === "decline")
      ? respond({ decision: value })
      : undefined;
  }
  // Slack carries one question: a button is an option, a reply a custom answer, as in Peer's panel.
  const [question, ...more] = request.questions;
  if (question === undefined || more.length > 0) return undefined;
  const option = answer.kind === "option" ? question.options[answer.index ?? -1] : undefined;
  const custom = answer.kind === "text" && question.allowCustomAnswer !== false ? text : undefined;
  const value = option === undefined ? custom : (option.value ?? option.label);
  return value === undefined ? undefined : respond({ answers: { [question.id]: value } });
}

/** What became of one answer now, or undefined while that cannot be told (T3's threads are not up). */
const settle = (s: Slack, workspace: string, answer: SlackAnswer, tracked: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const threads = s.threads();
    const world = yield* s.world(new Set([workspace]), tracked);
    if (threads === undefined || world === undefined) return undefined;
    const base = answer.waitKey.replace(/#\d+$/, "");
    const source = world.sources.get(answer.waitKey) ?? world.sources.get(base);
    if (source === undefined) return refuse("stale", world.why(base));
    return yield* (
      delivery(s, threads, source, answer) ?? Effect.succeed(refuse("failed", "unsupported"))
    );
  });

/** Asks each linked workspace for the answers waiting for this computer, and sees to each. */
export const deliverer = (s: Slack) =>
  Effect.gen(function* () {
    for (const [workspace, me] of s.mine) {
      if (!me.connected || me.link === null) continue;
      const inbox = yield* Effect.result(s.hub.inbox(workspace, s.environment));
      if (Result.isFailure(inbox)) continue;
      for (const answer of inbox.success.answers) {
        const { waits, delivered } = yield* s.ledger.read;
        const stored = delivered[answer.answer];
        const tracked = new Set(
          Object.keys(waits).filter((key) => waits[key]?.firstSeenAt !== null),
        );
        const verdict: Verdict | undefined =
          stored ?? (yield* settle(s, workspace, answer, tracked));
        if (verdict === undefined) continue;
        if (stored === undefined) {
          const outcome = { workspace, ...verdict };
          yield* s.ledger.update((l) => ({
            ...l,
            delivered: { ...l.delivered, [answer.answer]: outcome },
          }));
        }
        const { result, reason } = verdict;
        const told = yield* Effect.result(
          s.hub.report(workspace, answer.answer, { result, reason }),
        );
        // The Hub keeps an answer until told; one it refuses to take is forgotten here.
        if (Result.isSuccess(told) || told.failure.refused === true) {
          yield* s.ledger.update((l) => ({
            ...l,
            delivered: Object.fromEntries(
              Object.entries(l.delivered).filter(([key]) => key !== answer.answer),
            ),
          }));
        }
      }
    }
  });
