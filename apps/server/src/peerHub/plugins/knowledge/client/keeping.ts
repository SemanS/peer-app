// @effect-diagnostics nodeBuiltinImport:off - hashes the operation id a kept candidate is staged under.
/**
 * What people do with knowledge candidates: dismiss or propose one again (with why, for the
 * project's guidance), keep one (kontext writes it, staged, with what it stands on), read a shared
 * context for what to keep, and propose the project's guidance from what people decided.
 *
 * @module peerHub/plugins/knowledge/client/keeping
 */
import * as NodeCrypto from "node:crypto";

import {
  PeerHubError,
  isCandidateKept,
  type PeerHubCandidatesInput,
  type PeerHubDecideCandidateInput,
  type PeerHubHarvestInput,
  type PeerHubKeepCandidateInput,
  type PeerKnowledgeCandidate,
  type PeerKnowledgeStatus,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type * as PeerAgents from "../../../core/coordination/PeerAgents.ts";
import type * as PeerHubClient from "../../../core/hub/PeerHubClient.ts";
import type * as PeerState from "../../../core/state/PeerState.ts";
import type * as PeerStatus from "../../../core/status/PeerStatus.ts";
import type * as PeerWork from "../../../core/work/PeerWork.ts";
import type { knowledgeHub } from "./hub.ts";
import type { kontextIn } from "./kontext.ts";
import { codeIn, evidenceOf } from "./resolve.ts";

const hubError = (detail: string) => new PeerHubError({ detail });
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** One of kontext's commands; what kontext did not do fails with what it said. */
const kontextDid = <A>(command: () => Promise<A>) =>
  Effect.tryPromise({ try: command, catch: (failure) => hubError(messageOf(failure)) });

/** Why people dismissed candidates, for the project's guidance; the newest this many are kept. */
const DismissedReasons = Schema.Struct({ dismissed: Schema.Record(Schema.String, Schema.String) });
const REASONS_KEPT = 200;

/** The project's checkout here, with kontext in it. */
type Here = Omit<PeerKnowledgeStatus, "checkout" | "kontext"> & {
  readonly checkout: string;
  readonly kontext: ReturnType<typeof kontextIn>;
};

export function keepingFlows(deps: {
  readonly state: PeerState.PeerState["Service"];
  readonly client: PeerHubClient.PeerHubClient["Service"];
  readonly agents: PeerAgents.PeerAgents["Service"];
  readonly work: PeerWork.PeerWork["Service"];
  readonly status: PeerStatus.PeerStatus["Service"];
  readonly hub: ReturnType<typeof knowledgeHub>;
  readonly statusOf: (workspace: string, project: string) => Effect.Effect<PeerKnowledgeStatus>;
  readonly checkoutOf: (workspace: string, project: string) => Effect.Effect<Here, PeerHubError>;
  readonly storeOf: (workspace: string, project: string) => Effect.Effect<Here, PeerHubError>;
}) {
  const { state, client, agents, work, status, hub, statusOf, checkoutOf, storeOf } = deps;
  /** How people name the works of `tasks` here: a task's name, or the project's work outside tasks. */
  const workNames = (workspace: string, project: string, tasks: Iterable<string | undefined>) =>
    Effect.gen(function* () {
      const names = new Map<string, string>();
      for (const task of new Set(tasks)) {
        if (task !== undefined) names.set(task, yield* work.taskName(workspace, project, task));
      }
      return (task: string | undefined) =>
        task === undefined ? "work outside tasks" : (names.get(task) ?? task);
    });

  /** A shared context's text as the Hub keeps it; null when nobody wrote it. */
  const readContext = (workspace: string, project: string, contextScope: string) =>
    client.session.pipe(
      Effect.flatMap(({ hubUrl, session }) =>
        client.api.readContext(hubUrl, session, workspace, project, contextScope),
      ),
    );

  const reasons = state.pluginData("knowledge", DismissedReasons);
  const reasonKey = (workspace: string, project: string, id: string) =>
    `${workspace}/${project}/${id}`;
  const decide = Effect.fn("Knowledge.decide")(function* (input: PeerHubDecideCandidateInput) {
    yield* hub.decide(input.workspace, input.project, input.id, input.status);
    const reason = input.status === "dismissed" ? input.reason : undefined;
    if (reason !== undefined)
      yield* reasons.update((held) => {
        const dismissed = Object.entries(held._tag === "Some" ? held.value.dismissed : {});
        dismissed.push([reasonKey(input.workspace, input.project, input.id), reason]);
        return { dismissed: Object.fromEntries(dismissed.slice(-REASONS_KEPT)) };
      });
    // The count waiting in Work follows from the next view.
    yield* agents.hubChanged;
    return yield* status.publish;
  });

  const setup = Effect.fn("Knowledge.setup")(function* (input: PeerHubCandidatesInput) {
    const here = yield* checkoutOf(input.workspace, input.project);
    if (!here.store) yield* kontextDid(() => here.kontext.init());
    return yield* statusOf(input.workspace, input.project);
  });

  const keep = Effect.fn("Knowledge.keep")(function* (input: PeerHubKeepCandidateInput) {
    const store = yield* storeOf(input.workspace, input.project);
    const found = (yield* hub.candidates(input.workspace, input.project)).find(
      (one) => one.id === input.id,
    );
    if (found === undefined) return yield* hubError("That candidate is no longer there.");
    // A person who edited the text keeps their own words, as they wrote them.
    const edited = input.text !== undefined && input.text.trim() !== "";
    const candidate = edited ? { ...found, text: input.text!.trim() } : found;
    const where = yield* workNames(
      input.workspace,
      input.project,
      candidate.sources.map((source) => source.task),
    );
    // kontext's model words what came unworded, with the shared context of the work it came from.
    const task = candidate.sources[0]?.task;
    const word =
      !edited && candidate.detail === undefined && store.llm
        ? {
            context: yield* readContext(
              input.workspace,
              input.project,
              task === undefined ? "project" : `task:${task}`,
            ).pipe(
              Effect.map((context) =>
                context === null ? undefined : { subject: where(task), text: context.text },
              ),
              Effect.orElseSucceed(() => undefined),
            ),
          }
        : undefined;
    const code = yield* Effect.promise(() =>
      codeIn(
        store.checkout,
        candidate.sources.map((source) => source.text),
      ),
    );
    const kept = yield* kontextDid(() =>
      store.kontext.keep({
        project: input.project,
        operationId: `peer:knowledge:${NodeCrypto.createHash("sha256").update(`${input.workspace}/${input.project}/${input.id}`).digest("hex")}`,
        source: `peer://knowledge/${encodeURIComponent(input.workspace)}/${encodeURIComponent(input.project)}/${encodeURIComponent(input.id)}`,
        candidate,
        where,
        word,
        evidence: evidenceOf({
          sources: candidate.sources,
          finders: candidate.finders,
          ...(code === undefined ? {} : { code }),
        }),
        supersedes: input.supersedes,
      }),
    );
    yield* hub.decide(input.workspace, input.project, input.id, "promoted", kept.keptAs);
    yield* agents.hubChanged;
    yield* status.publish;
    return { checkout: store.checkout, ...kept };
  });

  const harvest = Effect.fn("Knowledge.harvest")(function* (input: PeerHubHarvestInput) {
    const store = yield* storeOf(input.workspace, input.project);
    if (!store.llm) {
      return yield* hubError("Reading a context for what to keep needs kontext's llm adapter.");
    }
    const context = yield* readContext(input.workspace, input.project, input.scope);
    if (context === null || context.text.trim() === "") {
      return yield* hubError("Nobody has written that context yet.");
    }
    const task = input.scope.startsWith("task:") ? input.scope.slice("task:".length) : undefined;
    const where = yield* workNames(input.workspace, input.project, [task]);
    const entries = yield* kontextDid(() =>
      store.kontext.harvest({ project: input.project, subject: where(task), text: context.text }),
    );
    for (const entry of entries) {
      yield* hub.propose(input.workspace, input.project, {
        text: entry.title,
        kind: entry.kind,
        detail: entry.body,
        paths: entry.paths,
        ...(task === undefined ? {} : { task }),
        origin: `context:${input.scope}@v${context.version}`,
      });
    }
    yield* agents.hubChanged;
    return { proposed: entries.length };
  });

  const improve = Effect.fn("Knowledge.improve")(function* (input: PeerHubCandidatesInput) {
    const store = yield* storeOf(input.workspace, input.project);
    if (!store.llm) return yield* hubError("Proposing guidance needs kontext's llm adapter.");
    const candidates = yield* hub.candidates(input.workspace, input.project);
    // The labels are people's decisions on what agents marked; a harvest is not an agent's mark.
    const marked = (candidate: PeerKnowledgeCandidate) =>
      candidate.sources.some((source) => source.tagged && source.origin === undefined);
    const decided = candidates.filter((candidate) => candidate.status !== "proposed");
    if (decided.length < 3) {
      return yield* hubError(
        `Keep or dismiss a few more candidates first: ${decided.length} decided, 3 needed.`,
      );
    }
    const held = yield* reasons.read;
    const whys = held._tag === "Some" ? held.value.dismissed : {};
    const staged = yield* kontextDid(() =>
      store.kontext.guidance({
        project: input.project,
        kept: decided.filter((c) => isCandidateKept(c.status) && marked(c)).map((c) => c.text),
        // What people said of a dismissal ("already in …") is part of what they decided.
        dismissed: decided
          .filter((c) => c.status === "dismissed" && marked(c))
          .map((c) => {
            const why = whys[reasonKey(input.workspace, input.project, c.id)];
            return why === undefined ? c.text : `${c.text} (dismissed: ${why})`;
          }),
        missed: decided.filter((c) => isCandidateKept(c.status) && !marked(c)).map((c) => c.text),
      }),
    );
    return { checkout: store.checkout, ...staged };
  });

  return { decide, setup, keep, harvest, improve };
}
