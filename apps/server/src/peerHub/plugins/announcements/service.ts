import {
  PeerHubError,
  type PeerAnnouncement,
  type PeerAnnouncementProjectInput,
  type PeerAnnouncementPostInput,
  type PeerAnnouncementWithdrawInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  type PeerHookContext,
  type PeerSessionView,
  type PeerHooks,
  type PersistedWorkspace,
  usage,
  refused,
} from "../../core/plugin.ts";
import { PeerAgents } from "../../core/coordination/PeerAgents.ts";
import { PeerHubClient } from "../../core/hub/PeerHubClient.ts";
import { PeerState } from "../../core/state/PeerState.ts";
import { PeerStatus } from "../../core/status/PeerStatus.ts";
import { makeCache } from "./cache.ts";
import { makeOutbox } from "./receipts.ts";
import {
  begin,
  candidates,
  confirmed,
  eligible,
  freshDelivery,
  prepare,
  seed,
} from "./delivery.ts";
import { announcementText } from "./text.ts";
import { makeHubClient } from "./hubClient.ts";
const isHubError = Schema.is(PeerHubError);

const make = Effect.gen(function* () {
  const clock = yield* Clock.Clock;
  const state = yield* PeerState;
  const agents = yield* PeerAgents;
  const publisher = yield* PeerStatus;
  const hub = makeHubClient(yield* PeerHubClient);
  const queued = new Set<string>();
  const queueRefresh = (workspace: string) =>
    Effect.sync(() => {
      queued.add(workspace);
    });
  const cache = makeCache(() => clock.currentTimeMillisUnsafe());
  const outbox = makeOutbox();
  const settings = state.pluginData("announcements", Schema.Struct({ wake: Schema.Boolean }));
  let wake = Option.getOrElse(yield* settings.read, () => ({ wake: true })).wake;
  const local = (session: PeerSessionView) => session.local("announcements", freshDelivery);
  const allowed = (workspaces: ReadonlyArray<PersistedWorkspace>) =>
    new Map(
      workspaces.map((workspace) => [
        workspace.slug,
        new Set(workspace.manifest?.projects.map((project) => project.id) ?? []),
      ]),
    );
  const belongs = (session: PeerAnnouncementProjectInput) =>
    allowed(state.current().persisted.workspaces).get(session.workspace)?.has(session.project) ===
    true;
  const log = (name: string, session: PeerSessionView, ids: ReadonlyArray<string>, chars = 0) =>
    agents.log(`announcement.${name}`, {
      session: session.id,
      runtimeGeneration: session.runtimeGeneration,
      ids,
      chars,
    });
  const checked = <A, E>(input: PeerAnnouncementProjectInput, call: Effect.Effect<A, E>) =>
    state.project(input.workspace, input.project).pipe(Effect.andThen(call));
  const refresh = (workspace: string) =>
    Effect.tryPromise({
      try: () =>
        cache.refresh(workspace, () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const batch = outbox.batch(workspace);
              if (batch.length > 0) yield* agents.report(workspace);
              const answer = yield* hub.sync(
                workspace,
                state.environmentId,
                batch.map(({ workspace: _workspace, ...receipt }) => receipt),
              );
              outbox.accepted(batch, clock.currentTimeMillisUnsafe());
              yield* agents.log("announcement.synced", {
                workspace,
                ids: answer?.announcements.map((row) => row.id) ?? [],
                receipts: batch.length,
              });
              return answer;
            }),
          ),
        ),
      catch: (cause) =>
        isHubError(cause) ? cause : new PeerHubError({ detail: "Could not sync announcements." }),
    }).pipe(
      Effect.tap(() => publisher.publish),
      Effect.tap(() => agents.hubChanged),
    );
  const failed = (workspace: string) =>
    agents
      .log("announcement.sync.failed", { workspace })
      .pipe(Effect.andThen(Effect.sync(() => outbox.failed(clock.currentTimeMillisUnsafe()))));
  const refreshQuiet = (workspace: string) =>
    refresh(workspace).pipe(Effect.catch(() => failed(workspace)));
  const text = (
    session: PeerSessionView,
    active: ReadonlyArray<PeerAnnouncement>,
    withdrawn: ReadonlyArray<PeerAnnouncement>,
    repeated = false,
  ) =>
    announcementText(active, withdrawn, {
      now: cache.now(session.workspace),
      email: state.current().persisted.email ?? "",
      name: (email) => state.nameOf(session.workspace, email),
      taskName: (id) =>
        state
          .current()
          .work.get(`${session.workspace}/${session.project}`)
          ?.tasks.find((task) => task.id === id)?.title ?? id,
      repeated,
    });
  const step = (ctx: PeerHookContext) =>
    Effect.sync(() => {
      const session = ctx.session;
      if (!belongs(session) || cache.unsupported(session.workspace)) return null;
      const delivery = local(session);
      seed(delivery, cache.entry(session.workspace).answer?.delivered ?? [], session);
      const selected = candidates(
        cache.rows(session.workspace),
        delivery,
        session,
        cache.now(session.workspace),
        { waking: ctx.waking === true, wake, start: ctx.event === "session-start" },
      );
      const active: PeerAnnouncement[] = [];
      const withdrawn: PeerAnnouncement[] = [];
      const max = ctx.event === "session-start" ? 2000 : 1200;
      for (const row of selected.active)
        if (text(session, [...active, row], withdrawn, delivery.repeats.size > 0).length <= max)
          active.push(row);
      for (const row of selected.withdrawn)
        if (text(session, active, [...withdrawn, row]).length <= max) withdrawn.push(row);
      if (active.length + withdrawn.length === 0) return null;
      if (ctx.waking) for (const row of active) delivery.waking.add(row.id);
      return {
        text: text(
          session,
          active,
          withdrawn,
          active.some((row) => delivery.repeats.has(row.id)),
        ),
        refs: prepare(delivery, active, withdrawn),
      };
    });
  const delivery: NonNullable<PeerHooks["delivery"]> = ({
    session,
    refs,
    state: step,
    chars = 0,
  }) =>
    Effect.gen(function* () {
      const told = local(session);
      const waking = refs.map((ref) => ref.slice(2)).filter((id) => told.waking.delete(id));
      const ids = confirmed(told, refs, step);
      if (step === "dropped") return;
      for (const announcement of ids)
        outbox.add(
          {
            workspace: session.workspace,
            project: session.project,
            announcement,
            session: session.id,
            state: step,
          },
          clock.currentTimeMillisUnsafe(),
        );
      yield* log(step === "modelInput" ? "verified" : "offered", session, ids, chars);
      if (waking.length > 0) yield* log("wake", session, waking, chars);
      const withdrawn = refs.filter((ref) => ref.startsWith("w:"));
      if (withdrawn.length > 0)
        yield* log(
          "withdrawal.told",
          session,
          withdrawn.map((ref) => ref.slice(2)),
        );
    });
  const command = (session: PeerSessionView, args: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const invalid = (reason: string) =>
        Effect.fail(usage(reason, "run peer announcements to see eligible handles."));
      if (!belongs(session))
        return yield* Effect.fail(
          refused(
            "This session is not in a workspace project.",
            "ask your person to share this project in Peer.",
          ),
        );
      if (
        cache.entry(session.workspace).answer === undefined ||
        clock.currentTimeMillisUnsafe() - cache.entry(session.workspace).at > 60000
      )
        yield* refreshQuiet(session.workspace).pipe(Effect.timeout(1200), Effect.ignore);
      if (cache.unsupported(session.workspace))
        return yield* Effect.fail(
          refused("This hub has no announcements.", "ask your person to update the Hub."),
        );
      const rows = cache
        .rows(session.workspace)
        .filter((row) => eligible(row, session, cache.now(session.workspace)));
      const told = local(session);
      seed(told, cache.entry(session.workspace).answer?.delivered ?? [], session);
      if (args.length === 0) {
        const withdrawn = cache
          .rows(session.workspace)
          .filter(
            (row) =>
              row.project === session.project &&
              row.withdrawnAt !== undefined &&
              told.told.has(row.id),
          );
        if (rows.length + withdrawn.length === 0) return "No announcements for this session.";
        yield* delivery({
          session,
          refs: prepare(told, rows, []),
          state: "offered",
          chars: text(session, rows, withdrawn).length,
        });
        return (
          text(session, rows, withdrawn) +
          (clock.currentTimeMillisUnsafe() - cache.entry(session.workspace).at > 600000
            ? "\nLast read more than 10 min ago."
            : "")
        );
      }
      if (args[0] !== "ack")
        return yield* invalid("Use peer announcements or peer announcements ack [id...].");
      const ids: string[] = [];
      for (const prefix of args.slice(1)) {
        if (!/^[a-zA-Z0-9_-]{4,}$/.test(prefix))
          return yield* invalid("Announcement handles need at least four characters.");
        const matching = rows.filter((row) => row.id.startsWith(prefix));
        if (matching.length !== 1)
          return yield* invalid(
            matching.length > 1
              ? "That announcement handle is ambiguous."
              : "That announcement is withdrawn, expired, unknown or not for this session.",
          );
        ids.push(matching[0]!.id);
      }
      if (args.length === 1)
        ids.push(
          ...rows
            .filter((row) => (told.told.get(row.id) ?? "prepared") !== "prepared")
            .map((row) => row.id),
        );
      if (ids.length === 0) return "No offered announcements to acknowledge.";
      const unique = [...new Set(ids)];
      confirmed(
        told,
        unique.map((id) => `a:${id}`),
        "acknowledged",
      );
      for (const announcement of unique)
        outbox.add(
          {
            workspace: session.workspace,
            project: session.project,
            announcement,
            session: session.id,
            state: "acknowledged",
          },
          clock.currentTimeMillisUnsafe(),
        );
      yield* log("acked", session, unique);
      return `Acknowledged ${unique.map((id) => id.slice(0, 6)).join(", ")}.`;
    });
  const flush = () => Effect.forEach(outbox.workspaces(), refreshQuiet, { discard: true });
  return {
    refresh,
    queueRefresh,
    step,
    delivery,
    command,
    flush,
    start: (ctx: PeerHookContext) =>
      Effect.gen(function* () {
        if (
          cache.entry(ctx.session.workspace).answer === undefined ||
          clock.currentTimeMillisUnsafe() - cache.entry(ctx.session.workspace).at > 60000
        )
          yield* refreshQuiet(ctx.session.workspace).pipe(Effect.timeout(1200), Effect.ignore);
        seed(
          local(ctx.session),
          cache.entry(ctx.session.workspace).answer?.delivered ?? [],
          ctx.session,
        );
        begin(local(ctx.session), ctx.source ?? "startup", cache.now(ctx.session.workspace));
        return yield* step(ctx);
      }),
    status: () => ({ ...cache.summary(), wake }),
    list: (input: PeerAnnouncementProjectInput) => checked(input, hub.list(input)),
    detail: (input: Parameters<typeof hub.detail>[0]) => checked(input, hub.detail(input)),
    post: (input: PeerAnnouncementPostInput) =>
      checked(input, hub.post(input)).pipe(
        Effect.tap((answer) =>
          Effect.sync(() => cache.post(input.workspace, answer, answer.replaced)),
        ),
        Effect.tap(() => publisher.publish),
        Effect.tap(() => queueRefresh(input.workspace)),
      ),
    withdraw: (input: PeerAnnouncementWithdrawInput) =>
      checked(input, hub.withdraw(input)).pipe(
        Effect.tap((answer) =>
          Effect.sync(() => cache.withdraw(input.workspace, answer.withdrawn)),
        ),
        Effect.tap(() => publisher.publish),
        Effect.tap(() => queueRefresh(input.workspace)),
      ),
    credentials: (input: PeerAnnouncementProjectInput) => checked(input, hub.credentials(input)),
    createCredential: (input: Parameters<typeof hub.createCredential>[0]) =>
      checked(input, hub.createCredential(input)),
    revokeCredential: (input: Parameters<typeof hub.revokeCredential>[0]) =>
      checked(input, hub.revokeCredential(input)),
    setWake: (input: { readonly wake: boolean }) =>
      settings
        .update(() => input)
        .pipe(
          state.lock.withPermits(1),
          Effect.tap(() =>
            Effect.sync(() => {
              wake = input.wake;
            }),
          ),
          Effect.tap(() => publisher.publish),
        ),
    cleanup: (workspaces: ReadonlyArray<PersistedWorkspace>) =>
      Effect.sync(() => {
        for (const workspace of queued)
          if (!workspaces.some((member) => member.slug === workspace)) queued.delete(workspace);
        cache.restrict(allowed(workspaces));
        outbox.forget(new Set(workspaces.map((workspace) => workspace.slug)));
      }),
    run: Effect.gen(function* () {
      yield* Effect.forEach(
        state.current().persisted.workspaces,
        (workspace) => refreshQuiet(workspace.slug),
        { discard: true },
      );
      return yield* Effect.forever(
        Effect.gen(function* () {
          yield* Effect.sleep("1 second");
          const pending = Array.from(queued);
          queued.clear();
          for (const workspace of pending) {
            yield* refreshQuiet(workspace);
          }
          if (outbox.due(clock.currentTimeMillisUnsafe())) yield* flush();
          const sessions = yield* agents.sessions;
          for (const workspace of new Set(sessions.map((session) => session.workspace)))
            if (clock.currentTimeMillisUnsafe() - cache.entry(workspace).at > 300000)
              yield* refreshQuiet(workspace);
        }),
      );
    }),
  };
});
export class PeerAnnouncements extends Context.Service<
  PeerAnnouncements,
  Effect.Success<typeof make>
>()("t3/peerHub/plugins/announcements/service/PeerAnnouncements") {}
export const layer = Layer.effect(PeerAnnouncements, make);
