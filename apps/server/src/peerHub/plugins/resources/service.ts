// @effect-diagnostics nodeBuiltinImport:off cryptoRandomUUID:off globalDate:off - one bounded operation id per explicit claim invocation.
import * as NodeCrypto from "node:crypto";
import {
  PeerHubError,
  type PeerIntentResponse,
  type PeerProjectPolicy,
  type PeerResourceReleaseInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  CliError,
  usage,
  refused,
  uncertain,
  type PeerCommandInput,
  type PeerHookContext,
  type PeerSessionView,
} from "../../core/plugin.ts";
import { PeerState } from "../../core/state/PeerState.ts";
import { PeerHubClient } from "../../core/hub/PeerHubClient.ts";
import { PeerAgents } from "../../core/coordination/PeerAgents.ts";
import { PeerStatus } from "../../core/status/PeerStatus.ts";
import { plain } from "../../peerText.ts";
import { makeHubClient } from "./hubClient.ts";
import { makeState, scopeKey } from "./state.ts";
import { bestRule } from "./pathRules.ts";
import { resourceName, leaseSeconds } from "./cli.ts";
import { freshNotices, holdLine, notices, resourceBlock } from "./texts.ts";
const make = Effect.gen(function* () {
  const clock = yield* Clock.Clock,
    state = yield* PeerState,
    agents = yield* PeerAgents,
    status = yield* PeerStatus;
  const hub = makeHubClient(yield* PeerHubClient);
  const cache = makeState(() => clock.currentTimeMillisUnsafe());
  const inFlight = new Set<string>(),
    dirty = new Set<string>();
  const local = (session: PeerSessionView) => session.local("resources", freshNotices);
  const rows = (session: PeerSessionView) =>
    belongs(session.workspace, session.project)
      ? (cache.read(session.workspace)?.held.filter((h) => h.project === session.project) ?? [])
      : [];
  const patterns = (session: PeerSessionView) =>
    belongs(session.workspace, session.project)
      ? (cache.read(session.workspace)?.patterns[session.project] ?? [])
      : [];
  const belongs = (workspace: string, project: string) =>
    state
      .current()
      .persisted.workspaces.some(
        (w) => w.slug === workspace && w.manifest?.projects.some((p) => p.id === project),
      );
  const queue = (workspace: string) =>
    Effect.sync(() => {
      cache.queue(workspace);
      if (inFlight.has(workspace)) dirty.add(workspace);
    });
  const refresh = (workspace: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (inFlight.has(workspace)) {
        dirty.add(workspace);
        return;
      }
      inFlight.add(workspace);
      yield* Effect.gen(function* () {
        const answer = yield* hub.list(workspace);
        if (!state.current().persisted.workspaces.some((w) => w.slug === workspace)) return;
        if (answer === null) cache.unsupported(workspace);
        else
          cache.accept(workspace, {
            ...answer,
            held: answer.held.filter((h) => belongs(workspace, h.project)),
            patterns: Object.fromEntries(
              Object.entries(answer.patterns).filter(([project]) => belongs(workspace, project)),
            ),
          });
        yield* status.publish;
        yield* agents.hubChanged;
      }).pipe(
        Effect.catch(() => Effect.sync(() => cache.queue(workspace, 10_000))),
        Effect.ensuring(
          Effect.sync(() => {
            inFlight.delete(workspace);
            if (dirty.delete(workspace)) cache.queue(workspace);
          }),
        ),
      );
    });
  const required = <A>(workspace: string, answer: A | null) =>
    answer === null
      ? Effect.gen(function* () {
          cache.unsupported(workspace);
          return yield* new PeerHubError({
            detail: "This Hub does not support resource claims yet.",
            refused: true,
          });
        })
      : Effect.succeed(answer);
  const retry = <A>(call: Effect.Effect<A, PeerHubError>) =>
    call.pipe(
      Effect.catch((error) =>
        error.detail.startsWith("Could not reach the hub") ? call : Effect.fail(error),
      ),
    );
  const log = (kind: string, session: PeerSessionView, target: string) =>
    agents.log(`resource.${kind}`, {
      session: session.id,
      runtimeGeneration: session.runtimeGeneration,
      workspace: session.workspace,
      project: session.project,
      target,
    });
  const canRelease = (session: PeerSessionView, target: string) =>
    target.startsWith("resource:") ||
    // Intent can confirm a hold before the configured pattern snapshot arrives.
    rows(session).some((h) => h.kind === "pattern" && h.name === target) ||
    patterns(session).some((r) => r.policy === "exclusive" && r.pattern === target) ||
    bestRule(patterns(session), target)?.policy === "exclusive";
  const validate = (command: "claim" | "release", input: PeerCommandInput) => {
    if (command === "claim") {
      const resources = input.plain.filter((t) => t.startsWith("resource:"));
      for (const target of resources) resourceName(target);
      leaseSeconds(input.flag("--ttl"));
      if (input.flag("--ttl") !== undefined && !resources.length)
        throw usage(
          "--ttl applies only to resource claims.",
          "include resource:<name> or omit --ttl.",
        );
      if (new Set(resources.map(resourceName)).size > 8)
        throw usage(
          "Claim at most 8 resources per session.",
          "release an existing resource before claiming another.",
        );
    } else
      for (const target of input.plain) if (target.startsWith("resource:")) resourceName(target);
  };
  const command = (kind: "claim" | "release", input: PeerCommandInput) =>
    Effect.gen(function* () {
      const { session } = input;
      yield* Effect.try({
        try: () => validate(kind, input),
        catch: (error) =>
          error instanceof CliError ? error : usage("Invalid claim input.", "run peer help."),
      });
      if (!belongs(session.workspace, session.project))
        return yield* Effect.fail(
          refused("This project is no longer available.", "ask your person to sync Peer."),
        );
      if (!cache.supported(session.workspace))
        return yield* Effect.fail(
          refused(
            "This Hub does not support resource claims yet.",
            "ask your person to update the Hub, then retry later.",
          ),
        );
      yield* agents.sync(session.workspace, 1000);
      if (!belongs(session.workspace, session.project))
        return yield* Effect.fail(
          refused("This project is no longer available.", "ask your person to sync Peer."),
        );
      const base = NodeCrypto.randomUUID();
      const targets =
        kind === "claim"
          ? [...new Set(input.plain.map((t) => `resource:${resourceName(t)}`))]
          : input.plain.length
            ? [...input.plain]
            : rows(session)
                .filter((h) => h.holder.session === session.id)
                .map((h) => (h.kind === "resource" ? `resource:${h.name}` : h.name));
      const output: string[] = [];
      for (const [i, target] of targets.entries()) {
        const result = yield* Effect.result(
          Effect.gen(function* () {
            if (kind === "claim") {
              const answer = yield* retry(
                hub.claim(session.workspace, session.project, {
                  environment: state.environmentId,
                  session: session.id,
                  name: resourceName(target),
                  ttlSeconds: leaseSeconds(input.flag("--ttl")),
                  ...(input.flag("--intent") === undefined
                    ? {}
                    : { intent: plain(input.flag("--intent")!, 200) }),
                  op: `${base}:${i}`,
                }),
              ).pipe(Effect.flatMap((a) => required(session.workspace, a)));
              cache.own(session.workspace, answer.resource, answer.at);
              if (answer.verdict === "held") {
                local(session).refused.add(scopeKey(answer.resource));
                local(session).told.delete(`free:${scopeKey(answer.resource)}`);
                yield* log("refused", session, target);
                return yield* Effect.fail(
                  refused(
                    `${target} is held by ${holdLine(answer.resource, session.id, cache.hubNow(session.workspace), (email) => state.nameOf(session.workspace, email))}.`,
                    "wait for release or expiry, then retry.",
                  ),
                );
              }
              local(session).known.set(scopeKey(answer.resource), answer.resource);
              local(session).refused.delete(scopeKey(answer.resource));
              yield* log("claim", session, target);
              yield* status.publish;
              return `Held ${target}: ${holdLine(answer.resource, session.id, cache.hubNow(session.workspace), (email) => state.nameOf(session.workspace, email))}. Release with peer release ${target}.`;
            }
            const answer = yield* retry(
              hub.release(session.workspace, session.project, {
                environment: state.environmentId,
                session: session.id,
                target,
                op: `${base}:${i}`,
              }),
            ).pipe(Effect.flatMap((a) => required(session.workspace, a)));
            if (answer.resource)
              cache.own(session.workspace, answer.resource, answer.at, answer.released);
            if (answer.reason === "held_by_other")
              return yield* Effect.fail(
                refused(
                  `${target} is held by ${answer.resource?.holder.email ?? "another agent"}; nothing was released.`,
                  "ask its person or a project lead to release it.",
                ),
              );
            if (answer.released) {
              for (const [key, h] of local(session).known)
                if ((h.kind === "resource" ? `resource:${h.name}` : h.name) === target)
                  local(session).known.delete(key);
            }
            yield* log("release", session, target);
            yield* status.publish;
            return answer.released
              ? `Released ${target}.`
              : `${target}: not held; nothing was released.`;
          }),
        );
        if (result._tag === "Failure") {
          if (output.length)
            return yield* Effect.fail(
              uncertain(kind, "An earlier target took effect before a later target failed"),
            );
          const e = result.failure;
          return yield* Effect.fail(
            e instanceof CliError
              ? e
              : e.refused
                ? refused(e.detail, "run peer status and retry when the requirement is met.")
                : uncertain(
                    kind,
                    "The Hub gave no usable answer; no local hold was added or removed",
                  ),
          );
        }
        output.push(result.success);
      }
      return output.join("\n");
    });
  const releasePerson = (input: PeerResourceReleaseInput) =>
    state.project(input.workspace, input.project).pipe(
      Effect.andThen(
        hub.release(input.workspace, input.project, {
          target: input.target,
          op: input.op ?? NodeCrypto.randomUUID(),
        }),
      ),
      Effect.flatMap((a) => required(input.workspace, a)),
      Effect.tap((answer) =>
        Effect.gen(function* () {
          if (answer.resource)
            cache.own(input.workspace, answer.resource, answer.at, answer.released);
          yield* status.publish;
          yield* queue(input.workspace);
          yield* agents.hubChanged;
        }),
      ),
    );
  const block = (session: PeerSessionView) =>
    Effect.sync(() =>
      resourceBlock(
        rows(session),
        patterns(session),
        session.id,
        cache.hubNow(session.workspace),
        (email) => state.nameOf(session.workspace, email),
      ),
    );
  const start = (ctx: PeerHookContext) =>
    Effect.gen(function* () {
      const bag = local(ctx.session);
      if (ctx.source !== "compact" && bag.told.has("start")) return null;
      const text = yield* block(ctx.session);
      if (text !== null) bag.told.add("start");
      return text;
    });
  const step = (ctx: PeerHookContext) =>
    Effect.gen(function* () {
      if (ctx.waking || !belongs(ctx.session.workspace, ctx.session.project)) return null;
      const bag = local(ctx.session),
        text = notices(bag, rows(ctx.session), ctx.session.id, cache.hubNow(ctx.session.workspace));
      if (text?.includes("no longer held")) yield* log("lost", ctx.session, "leased scope");
      return text;
    });
  const intentResult = (session: PeerSessionView, answer: PeerIntentResponse) =>
    Effect.sync(() => {
      if (!belongs(session.workspace, session.project)) return;
      for (const verdict of answer.verdicts)
        if (verdict.pattern && verdict.hold?.expiresAt) {
          cache.own(
            session.workspace,
            {
              project: session.project,
              kind: "pattern",
              name: verdict.pattern,
              holder: {
                session: verdict.hold.session,
                email: verdict.hold.email,
                environment: verdict.hold.environment,
              },
              ...(verdict.hold.intent === undefined ? {} : { intent: verdict.hold.intent }),
              expiresAt: verdict.hold.expiresAt,
            },
            answer.at,
          );
        }
    });
  return {
    command,
    validate,
    canRelease,
    refresh,
    queue,
    block,
    start,
    step,
    intentResult,
    releasePerson,
    policyFor: (session: PeerSessionView, path: string, base: PeerProjectPolicy) =>
      bestRule(patterns(session), path)?.policy ?? base,
    status: () => ({
      held: cache
        .entries()
        .flatMap(([workspace, e]) =>
          (e.answer?.held ?? [])
            .filter((h) => belongs(workspace, h.project))
            .map((h) => ({ ...h, workspace, at: new Date(cache.hubNow(workspace)).toISOString() })),
        ),
    }),
    cleanup: (workspaces: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        cache.forget(workspaces);
        for (const session of yield* agents.sessions)
          if (!workspaces.includes(session.workspace)) {
            const bag = local(session);
            bag.known.clear();
            bag.told.clear();
            bag.refused.clear();
          }
      }),
    run: Effect.gen(function* () {
      cache.forget(state.current().persisted.workspaces.map((w) => w.slug));
      for (const w of state.current().persisted.workspaces) yield* refresh(w.slug);
      while (true) {
        yield* Effect.sleep("250 millis");
        for (const workspace of cache.due()) yield* refresh(workspace);
      }
    }),
  };
});
export class PeerResources extends Context.Service<PeerResources, Effect.Success<typeof make>>()(
  "t3/peerHub/plugins/resources/service/PeerResources",
) {}
export const layer = Layer.effect(PeerResources, make);
