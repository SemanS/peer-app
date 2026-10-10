/**
 * world — what this computer's agents wait on now: the Peer threads and herdr agents of some
 * workspaces, each with where it works as the work report puts it, made into waits by `slackWaits`.
 *
 * @module peerHub/plugins/slack/world
 */
import type { RunId, RuntimeRequestId, ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { ThreadManagementServiceShape } from "../../../orchestration-v2/ThreadManagementService.ts";
import type * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import type * as PeerWork from "../../core/work/PeerWork.ts";
import {
  agentKey,
  slackWaits,
  turnEndedAt,
  type SlackPlace,
  type SlackRequest,
  type SlackWait,
  type SlackWaitAgent,
  type SlackWaitThread,
} from "./waits.ts";

/** What the plugin uses of T3's threads. */
export type SlackThreads = Pick<
  ThreadManagementServiceShape,
  "getShellSnapshot" | "getThreadRecords" | "dispatch" | "sendToThread"
>;
/** A wait, and the thread or agent it was made of. */
export type Source = { readonly wait: SlackWait } & (
  | { readonly thread: SlackWaitThread }
  | { readonly agent: SlackWaitAgent }
);
export interface World {
  readonly waits: ReadonlyArray<SlackWait>;
  readonly sources: ReadonlyMap<string, Source>;
  /** Why no wait has this key now: its request was answered, its agent moved on, or it is gone. */
  readonly why: (key: string) => "handled" | "moved-on" | "ended";
}

/** A finished turn is news this long after it ended, and for as long as the ledger tracks it. */
const NEWS_MS = 30 * 60_000;

/** The request a thread waits on, if Slack's answer can still reach it. */
const requestOf = (threads: SlackThreads, thread: ThreadId, id: RuntimeRequestId) =>
  threads
    .getThreadRecords(thread, ["runtimeRequests", "turnItems"], {
      turnItemTypes: ["approval_request", "user_input_request"],
    })
    .pipe(
      Effect.map(({ runtimeRequests, turnItems }): SlackRequest | undefined => {
        const asked = runtimeRequests.find((request) => request.id === id);
        const item = turnItems.findLast(
          (i) =>
            (i.type === "approval_request" || i.type === "user_input_request") &&
            i.requestId === id,
        );
        if (asked?.status !== "pending" || asked.responseCapability.type === "not_resumable")
          return;
        if (item?.type === "approval_request")
          return { kind: "approval", requestId: id, prompt: item.prompt };
        if (item?.type === "user_input_request") {
          return { kind: "user_input", requestId: id, questions: item.questions };
        }
      }),
      Effect.orElseSucceed(() => undefined),
    );

const lastWords = (threads: SlackThreads, thread: ThreadId, run: RunId) =>
  threads
    .getThreadRecords(thread, ["messages"], { messageRoles: ["assistant"], messageRunIds: [run] })
    .pipe(
      Effect.map(({ messages }) => messages.findLast((message) => !message.streaming)?.text),
      Effect.orElseSucceed(() => undefined),
    );

export type SlackWorld = (
  workspaces: ReadonlySet<string>,
  tracked: ReadonlySet<string>,
) => Effect.Effect<World | undefined>;

export const makeWorld = (d: {
  readonly work: PeerWork.PeerWork["Service"];
  readonly agents: PeerAgents.PeerAgents["Service"];
  readonly threads: () => SlackThreads | undefined;
  readonly computer: string;
}): SlackWorld => {
  const texts = new Map<string, string>();

  /**
   * The waits of agents in `workspaces` now, or undefined while T3's threads cannot be read, when
   * nothing may be concluded. A finished turn older than half an hour is history unless its key is
   * `tracked`: Slack hears of what finished while Peer ran, not of everything that ever did.
   */
  return (workspaces: ReadonlySet<string>, tracked: ReadonlySet<string>) =>
    Effect.gen(function* () {
      const threads = d.threads();
      if (threads === undefined) return undefined;
      const snapshot = yield* threads.getShellSnapshot({ location: "active" }).pipe(Effect.option);
      if (Option.isNone(snapshot)) return undefined;
      const now = yield* Clock.currentTimeMillis;
      const seen = new Set<string>();
      /** A last message is read once per wait, and again while there was none. */
      const cached = (key: string, read: Effect.Effect<string | undefined>) =>
        Effect.gen(function* () {
          seen.add(key);
          const text = texts.get(key) ?? (yield* read);
          if (text !== undefined) texts.set(key, text);
          return text;
        });

      // Where each of this computer's threads and agents works, as its work report puts it.
      const places = new Map<string, SlackPlace & { readonly previousId: string | undefined }>();
      for (const [workspace, rows] of yield* d.work.localThreads) {
        for (const row of rows) {
          const tasks = row.task === undefined ? [] : yield* d.work.tasks(workspace, row.project);
          const task = tasks.find((candidate) => candidate.id === row.task);
          const place = { workspace, project: row.project, previousId: row.previousId };
          places.set(row.id, { ...place, ...(task && { task }) });
        }
      }

      const shells = snapshot.value.threads;
      const items: SlackWaitThread[] = [];
      for (const shell of shells) {
        const place = places.get(`peer:${shell.id}`);
        const pending = shell.pendingRuntimeRequest;
        const ended = turnEndedAt(shell);
        const run = shell.latestRunId;
        const key = `peer:${shell.id}:run:${run}`;
        const news =
          ended !== undefined &&
          run !== null &&
          (now - DateTime.toEpochMillis(ended) <= NEWS_MS || tracked.has(key));
        if (place === undefined || shell.settledAt !== null || (pending === null && !news))
          continue;
        const request =
          pending === null ? undefined : yield* requestOf(threads, shell.id, pending.id);
        const text =
          news && run !== null ? yield* cached(key, lastWords(threads, shell.id, run)) : undefined;
        const latestMessage = text === undefined ? undefined : { role: "assistant", text };
        items.push({ shell, place, request, latestMessage });
      }

      const listed = yield* d.agents.runtimeAgents;
      const agents: SlackWaitAgent[] = [];
      for (const agent of listed) {
        const place = places.get(agent.id);
        // Typing into a terminal needs the session and turn that were read: a finished agent
        // without them is not posted. A blocked one is only a notice.
        const finished =
          agent.status === "done" && agent.session !== undefined && agent.turn !== undefined;
        if (place === undefined || !(finished || agent.status === "blocked")) continue;
        const read = d.agents.lastMessage(agent.paneId);
        const lastMessage = finished
          ? yield* cached(`${agentKey(agent)}:${agent.turn}`, read)
          : undefined;
        agents.push({ agent, place, lastMessage, previousId: place.previousId });
      }
      for (const key of texts.keys()) if (!seen.has(key)) texts.delete(key);

      const input = {
        connectedWorkspaces: workspaces,
        computer: d.computer,
        now: DateTime.formatIso(DateTime.makeUnsafe(now)),
      };
      const waits: SlackWait[] = [];
      const sources = new Map<string, Source>();
      const parts = [...items.map((thread) => ({ thread })), ...agents.map((agent) => ({ agent }))];
      for (const part of parts) {
        const one = {
          threads: "thread" in part ? [part.thread] : [],
          agents: "agent" in part ? [part.agent] : [],
        };
        for (const wait of slackWaits({ ...input, ...one })) {
          waits.push(wait);
          sources.set(wait.waitKey, { wait, ...part });
        }
      }
      const why = (key: string): ReturnType<World["why"]> => {
        const shell = shells.find((candidate) => key.startsWith(`peer:${candidate.id}:`));
        if (shell !== undefined)
          return key.startsWith(`peer:${shell.id}:run:`) ? "moved-on" : "handled";
        return listed.some((agent) => key.startsWith(`${agentKey(agent)}:`)) ? "moved-on" : "ended";
      };
      return { waits, sources, why } satisfies World;
    });
};
