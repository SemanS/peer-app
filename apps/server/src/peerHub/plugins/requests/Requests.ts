/**
 * Requests: team requests on this environment. A member asks a teammate, in the teammate's Needs
 * you, to start their agent on a task; the Hub keeps each request until its recipient accepts it,
 * which makes the task theirs, or dismisses it.
 *
 * While the plugin is active, Peer reads the requests addressed to the signed-in person from each
 * workspace: when the Hub pings `requests`, when pings may have been missed (a resync, connecting),
 * after each sync, and every 30 seconds.
 *
 * @module peerHub/plugins/requests/Requests
 */
import {
  PeerHubError,
  type PeerAgentRequest,
  type PeerHubDismissRequestInput,
  type PeerHubSendRequestInput,
  type PeerHubStatus,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";

import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import { requestsHub } from "./hub.ts";

/** How long the inboxes stand without a ping before Peer reads them again, as it does the work. */
const INBOX_INTERVAL = "30 seconds";

const hubError = (detail: string) => new PeerHubError({ detail });

export class Requests extends Context.Service<
  Requests,
  {
    /** The requests addressed to the signed-in person, with their workspaces, as last read. */
    readonly inbox: Effect.Effect<
      ReadonlyArray<{ readonly workspace: string; readonly request: PeerAgentRequest }>
    >;
    /** Reads a workspace's requests soon; a burst of these reads it once. */
    readonly readSoon: (workspace: string) => Effect.Effect<void>;
    /** Reads the requests now, then as they change and every 30 seconds, until interrupted. */
    readonly follow: Effect.Effect<never>;
    /** Forgets the requests read for the person signing out. */
    readonly forget: Effect.Effect<void>;
    /** Puts a request in a teammate's Needs you. */
    readonly send: (input: PeerHubSendRequestInput) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** Its recipient dismisses a request without starting an agent. */
    readonly dismiss: (
      input: PeerHubDismissRequestInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /**
     * Accepts a request addressed to the signed-in person for a task while it is pending, which
     * makes the task theirs; what its sender asked their agent to do.
     */
    readonly accept: (input: {
      readonly workspace: string;
      readonly project: string;
      readonly task: string;
      readonly requestId: string;
    }) => Effect.Effect<{ readonly prompt: string }, PeerHubError>;
  }
>()("t3/peerHub/plugins/requests/Requests") {}

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const status = yield* PeerStatus.PeerStatus;
  const work = yield* PeerWork.PeerWork;
  const hub = requestsHub(yield* PeerHubClient.PeerHubClient);
  const inboxes = yield* Ref.make<ReadonlyMap<string, ReadonlyArray<PeerAgentRequest>>>(new Map());
  const changed = yield* Queue.unbounded<string>();

  /** Reads one workspace's requests; one the Hub does not answer for keeps what was read before. */
  const read = (workspace: string) =>
    hub.inbox(workspace).pipe(
      Effect.flatMap((requests) =>
        Ref.update(inboxes, (current) => new Map(current).set(workspace, requests)),
      ),
      Effect.ignore,
    );

  /** Forgets the requests of workspaces the person no longer belongs to. */
  const prune = Effect.gen(function* () {
    const workspaces = new Set((yield* state.workspaces).map((workspace) => workspace.slug));
    yield* Ref.update(
      inboxes,
      (current) => new Map([...current].filter(([workspace]) => workspaces.has(workspace))),
    );
  });

  const readAll = Effect.gen(function* () {
    for (const workspace of yield* state.workspaces) yield* read(workspace.slug);
    yield* prune;
  });

  const follow: Requests["Service"]["follow"] = Effect.gen(function* () {
    yield* readAll;
    yield* status.publish;
    while (true) {
      const woken = yield* Queue.take(changed).pipe(Effect.timeoutOption(INBOX_INTERVAL));
      if (Option.isNone(woken)) yield* readAll;
      else {
        for (const workspace of new Set([woken.value, ...(yield* Queue.clear(changed))])) {
          yield* read(workspace);
        }
        yield* prune;
      }
      yield* status.publish;
    }
  });

  const send: Requests["Service"]["send"] = Effect.fn("Requests.send")(function* (input) {
    yield* hub.send(input);
    // A request may have opened its task; the work shows it.
    yield* work.refresh();
    yield* readAll;
    return yield* status.publish;
  }, state.lock.withPermits(1));

  const dismiss: Requests["Service"]["dismiss"] = Effect.fn("Requests.dismiss")(function* (input) {
    yield* hub.respond(input.workspace, input.projectId, input.requestId, "dismissed");
    yield* work.refresh();
    yield* readAll;
    return yield* status.publish;
  }, state.lock.withPermits(1));

  const accept: Requests["Service"]["accept"] = Effect.fn("Requests.accept")(function* (input) {
    const email = yield* state.email;
    const request = (yield* hub.inbox(input.workspace)).find(
      (request) =>
        request.id === input.requestId &&
        request.project === input.project &&
        request.task === input.task &&
        request.recipient === email &&
        request.status === "pending",
    );
    if (request === undefined) {
      return yield* hubError(
        "This request is no longer pending for you on this task. Inspect the task before starting another agent.",
      );
    }
    yield* hub.respond(input.workspace, input.project, request.id, "accepted");
    yield* read(input.workspace);
    return { prompt: request.prompt };
  });

  return Requests.of({
    inbox: Effect.gen(function* () {
      if ((yield* state.email) === null) return [];
      return [...(yield* Ref.get(inboxes))].flatMap(([workspace, requests]) =>
        requests.map((request) => ({ workspace, request })),
      );
    }),
    readSoon: (workspace) => Queue.offer(changed, workspace).pipe(Effect.asVoid),
    follow,
    forget: Ref.set(inboxes, new Map()),
    send,
    dismiss,
    accept,
  });
});

export const layer = Layer.effect(Requests, make);
