import { PeerGitHubStatus, PeerHubError, type PeerGitHubVerification } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import type { PeerSessionView } from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import { gitHubRepository } from "../../workLifecycle.ts";
import {
  START_LINE,
  deliveryMemory,
  deliveryNotices,
  deliveryText,
  keepDelivery,
} from "./delivery.ts";

const unsupported = {
  configured: false,
  unsupported: true,
  webhookPath: "",
  lastPingAt: null,
  lastVerifiedAt: null,
  repositories: [],
} as const;
export class GitHubVerification extends Context.Service<
  GitHubVerification,
  {
    readonly status: (workspace: string) => Effect.Effect<PeerGitHubStatus, PeerHubError>;
    readonly snapshot: Effect.Effect<ReadonlyArray<PeerGitHubVerification>>;
    readonly refresh: Effect.Effect<void>;
    readonly reset: Effect.Effect<void>;
    readonly forget: (workspace: string) => Effect.Effect<void>;
    readonly clean: (workspaces: ReadonlyArray<string>) => Effect.Effect<void>;
    readonly start: (session: PeerSessionView) => Effect.Effect<string | null>;
    readonly notice: (session: PeerSessionView) => Effect.Effect<string | null>;
    readonly delivery: (
      session: PeerSessionView,
      task: string,
    ) => Effect.Effect<string, PeerHubError>;
  }
>()("t3/peerHub/plugins/github/status/GitHubVerification") {}
const make = Effect.gen(function* () {
  const client = yield* PeerHubClient.PeerHubClient;
  const state = yield* PeerState.PeerState;
  const work = yield* PeerWork.PeerWork;
  const published = yield* PeerStatus.PeerStatus;
  const cache = yield* Ref.make(new Map<string, PeerGitHubStatus>());
  let epoch = 0;
  const status = (workspace: string) =>
    Effect.gen(function* () {
      const answer = yield* client.request(PeerGitHubStatus, {
        workspace,
        path: "/github/status",
        unsupported: { value: unsupported },
      });
      const { hubUrl } = yield* client.session;
      // Only the workspace's known route can become a link; a Hub cannot supply another origin.
      const expected = `/v1/workspaces/${encodeURIComponent(workspace)}/github/webhook`;
      const result: PeerGitHubStatus = {
        ...answer,
        ...(answer.webhookPath === expected ? { webhookUrl: `${hubUrl}${expected}` } : {}),
      };
      yield* Ref.update(cache, (current) => new Map(current).set(workspace, result));
      yield* published.publish;
      return result;
    });
  const refresh = Effect.gen(function* () {
    for (const workspace of (yield* state.read).persisted.workspaces)
      yield* status(workspace.slug).pipe(Effect.ignore);
  });
  const configured = (workspace: string) =>
    Effect.map(Ref.get(cache), (values) => values.get(workspace)?.configured === true);
  return GitHubVerification.of({
    status,
    refresh,
    reset: Effect.sync(() => {
      epoch++;
    }),
    forget: (workspace) =>
      Ref.update(cache, (values) => {
        const next = new Map(values);
        next.delete(workspace);
        return next;
      }),
    clean: (workspaces) =>
      Ref.update(
        cache,
        (values) => new Map([...values].filter(([slug]) => workspaces.includes(slug))),
      ),
    snapshot: Effect.map(Ref.get(cache), (values) =>
      [...values].map(([workspace, value]) => ({
        workspace,
        configured: value.configured,
        lastVerifiedAt: value.lastVerifiedAt,
        ...(value.unsupported ? { unsupported: true } : {}),
      })),
    ),
    start: (session) =>
      Effect.gen(function* () {
        if (!(yield* configured(session.workspace))) return null;
        const snapshot = yield* state.read;
        const project = snapshot.persisted.workspaces
          .find((w) => w.slug === session.workspace)
          ?.manifest?.projects.find((p) => p.id === session.project);
        if (!project?.repositories.some((r) => gitHubRepository(r.url) !== null)) return null;
        const memory = deliveryMemory(session, epoch);
        if (memory.introduced) return null;
        memory.introduced = true;
        keepDelivery(session, memory);
        return START_LINE;
      }),
    notice: (session) =>
      Effect.gen(function* () {
        if (!session.task || !(yield* configured(session.workspace))) return null;
        const task = (yield* work.tasks(session.workspace, session.project)).find(
          (t) => t.id === session.task,
        );
        const name = task?.key ?? session.task;
        const memory = deliveryMemory(session, epoch);
        const said = deliveryNotices(
          memory,
          yield* work.threads(session.workspace, session.project),
          session.task,
          name,
          epoch,
        );
        keepDelivery(session, memory);
        return said;
      }),
    delivery: (session, named) =>
      Effect.gen(function* () {
        const tasks = yield* work.tasks(session.workspace, session.project);
        const task = tasks.find((t) =>
          named
            ? t.id.toLowerCase() === named.toLowerCase() ||
              t.key?.toLowerCase() === named.toLowerCase()
            : t.id === session.task,
        );
        if (!task)
          return yield* new PeerHubError({
            detail: "Unknown task. Use peer status to list this project's tasks.",
            refused: true,
          });
        const project = (yield* state.read).persisted.workspaces
          .find((w) => w.slug === session.workspace)
          ?.manifest?.projects.find((p) => p.id === session.project);
        return deliveryText(
          yield* work.threads(session.workspace, session.project),
          task.id,
          task.key ?? task.id,
          yield* configured(session.workspace),
          new Map(project?.members.map((m) => [m.email, m.name]) ?? []),
        );
      }),
  });
});
export const layer = Layer.effect(GitHubVerification, make);
