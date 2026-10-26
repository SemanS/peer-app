import {
  PEER_LOCAL_WORKSPACE,
  PeerHubError,
  type PeerContextViewInput,
  type PeerContextView as ContextView,
  type PeerContextArchiveInput,
  type PeerContextArchive,
  PeerContextIdentity,
  type PeerWorkContextText,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as PeerCoordination from "../coordination/PeerCoordination.ts";
import * as PeerState from "../state/PeerState.ts";
import * as PeerStatus from "../status/PeerStatus.ts";
import { composeContextView, contextArchive, contextPage } from "./contextView.ts";

export class PeerContextView extends Context.Service<
  PeerContextView,
  {
    readonly read: (input: PeerContextViewInput) => Effect.Effect<ContextView, PeerHubError>;
    readonly discover: (
      input: PeerContextArchiveInput,
    ) => Effect.Effect<PeerContextArchive, PeerHubError>;
  }
>()("t3/peerHub/core/index/PeerContextView") {}

const isPeerHubError = Schema.is(PeerHubError);
const encodeIdentity = Schema.encodeEffect(Schema.fromJsonString(PeerContextIdentity));

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const status = yield* PeerStatus.PeerStatus;
  const coordination = yield* PeerCoordination.PeerCoordination;
  const snapshot = Effect.fnUntraced(function* (input: {
    workspace: string;
    project: string;
    scope?: string;
  }) {
    const runtime = yield* state.read;
    const view = yield* status.publish;
    const local = input.workspace === PEER_LOCAL_WORKSPACE;
    const identity: PeerContextIdentity = {
      backend: local ? "local" : "hub",
      authority: local
        ? `local:${state.environmentId}`
        : runtime.persisted.hubUrl === null
          ? "hub:unavailable"
          : new URL(runtime.persisted.hubUrl).href.replace(/\/+$/, ""),
      environment: state.environmentId,
      workspace: input.workspace,
      project: input.project,
      scope: input.scope ?? "project-aggregate",
    };
    const project = view.workspaces
      .find((workspace) => workspace.slug === input.workspace)
      ?.projects.find((project) => project.project.id === input.project);
    const contexts = view.coordination.contexts.filter(
      (context) => context.workspace === input.workspace && context.project === input.project,
    );
    const findings = view.coordination.findings.filter(
      (finding) => finding.workspace === input.workspace && finding.project === input.project,
    );
    const tasks = project?.work.tasks ?? [];
    const availability = !view.coordination.enabled
      ? ("disabled" as const)
      : !local &&
          (runtime.workspaceErrors.has(input.workspace) ||
            runtime.persisted.hubUrl === null ||
            project === undefined)
        ? ("unavailable" as const)
        : ("available" as const);
    return {
      identity,
      contexts,
      findings,
      tasks,
      availability,
      generatedAt: DateTime.formatIso(yield* DateTime.now),
    };
  });
  const discover: PeerContextView["Service"]["discover"] = Effect.fn("PeerContextView.discover")(
    function* (input) {
      const source = yield* snapshot(input);
      return yield* Effect.try({
        try: () => contextArchive({ ...source, ...input }),
        catch: (cause) =>
          isPeerHubError(cause)
            ? cause
            : new PeerHubError({ detail: "Could not assemble the context archive." }),
      });
    },
  );
  const read: PeerContextView["Service"]["read"] = Effect.fn("PeerContextView.read")(
    function* (input) {
      const source = yield* snapshot(input);
      const metadata = new Map(source.contexts.map((context) => [context.scope, context]));
      const allScopes = new Set([
        ...metadata.keys(),
        ...source.tasks.map((task) => `task:${task.id}`),
      ]);
      if (input.scope !== "project-aggregate") {
        allScopes.clear();
        allScopes.add(input.scope);
      }
      const taskMetadata = new Map(source.tasks.map((task) => [`task:${task.id}`, task]));
      const listed = [...allScopes]
        .sort(
          (a, b) =>
            Number(taskMetadata.get(a)?.status === "done") -
              Number(taskMetadata.get(b)?.status === "done") || a.localeCompare(b),
        )
        .map((scope) => ({
          scope,
          revision: metadata.get(scope)?.version ?? 0,
          taskRevision: taskMetadata.get(scope)?.updatedAt ?? null,
        }));
      const identityKey = yield* encodeIdentity(source.identity).pipe(
        Effect.mapError(() => new PeerHubError({ detail: "Invalid context identity." })),
      );
      const selected = yield* Effect.try({
        try: () => contextPage(listed, identityKey, input.limit, input.cursor),
        catch: (cause) =>
          isPeerHubError(cause)
            ? cause
            : new PeerHubError({ detail: "Could not page context sources." }),
      });
      const readsAllowed = source.availability !== "disabled";
      const observations = yield* Effect.forEach(
        selected.selected,
        ({
          scope,
        }): Effect.Effect<{
          scope: string;
          context: PeerWorkContextText | null;
          availability: ContextView["sources"][number]["availability"];
        }> =>
          readsAllowed
            ? coordination
                .readContext({ workspace: input.workspace, project: input.project, scope })
                .pipe(
                  Effect.map((context) => ({
                    scope,
                    context,
                    availability: context === null ? ("empty" as const) : ("available" as const),
                  })),
                  Effect.catch((cause) =>
                    Effect.succeed({
                      scope,
                      context: null,
                      availability:
                        cause.status === 403 ? ("forbidden" as const) : ("unavailable" as const),
                    }),
                  ),
                )
            : Effect.succeed({ scope, context: null, availability: "disabled" as const }),
        { concurrency: 4 },
      );
      const reads =
        input.session === undefined || !readsAllowed
          ? null
          : yield* coordination
              .staleReads({
                workspace: input.workspace,
                project: input.project,
                session: input.session,
                environment: input.environment ?? state.environmentId,
              })
              .pipe(Effect.orElseSucceed(() => null));
      const pending = !readsAllowed
        ? null
        : yield* coordination
            .pendingFindings({
              workspace: input.workspace,
              project: input.project,
              scope: input.scope === "project-aggregate" ? undefined : input.scope,
              cursor: input.findingCursor,
              limit: input.limit ?? 20,
            })
            .pipe(Effect.orElseSucceed(() => null));
      const result = yield* Effect.try({
        try: () =>
          composeContextView({
            ...source,
            contexts: observations.flatMap((observation) =>
              observation.context === null ? [] : [observation.context],
            ),
            tasks: source.tasks.filter(
              (task) => input.scope === "project-aggregate" || input.scope === `task:${task.id}`,
            ),
            taskScopes: selected.selected.map((entry) => entry.scope),
            findings: [],
            reads,
            limit: input.limit,
            inputCursor: input.inputCursor,
          }),
        catch: (cause) =>
          isPeerHubError(cause)
            ? cause
            : new PeerHubError({ detail: "Could not assemble the current context." }),
      });
      const failedSources = observations.flatMap(({ scope, context, availability }) =>
        context !== null
          ? []
          : [
              {
                id: `${identityKey}:${scope}:${availability}`,
                kind: "context" as const,
                objectId: scope,
                scope,
                revision: null,
                observedAt: source.generatedAt,
                availability,
              },
            ],
      );
      return {
        ...result,
        sources: [...result.sources.filter((entry) => entry.revision !== null), ...failedSources],
        coverage: selected.coverage,
        pendingFindings:
          pending === null || pending.unsupported === true
            ? {
                ids: [],
                items: [],
                availability: "unavailable",
                coverage: {
                  total: 0,
                  omittedCount: 0,
                  nextCursor: null,
                  historyAvailableFrom: null,
                },
              }
            : {
                ids: pending.findings.map((finding) => finding.id),
                items: pending.findings.map((finding) => ({
                  id: finding.id,
                  text: finding.text,
                  email: finding.email,
                  at: finding.at,
                  scope: finding.task === undefined ? "project" : `task:${finding.task}`,
                })),
                availability: "available",
                coverage: {
                  total: pending.findings.length + pending.omittedCount,
                  omittedCount: pending.omittedCount,
                  nextCursor: pending.nextCursor ?? null,
                  historyAvailableFrom: null,
                },
              },
      };
    },
  );
  yield* coordination.contextViewsFrom({ read, discover });
  return PeerContextView.of({ read, discover });
});

export const layer = Layer.effect(PeerContextView, make);
