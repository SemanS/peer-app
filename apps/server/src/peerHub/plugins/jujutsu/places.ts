/**
 * Where agents work and who else is: the plugin's records (a workspace's own changes, task and
 * bookmark, by root), the checkout a directory belongs to, and the other sessions' changes a
 * command could name. The parts of the plugin share them.
 *
 * @module peerHub/plugins/jujutsu/places
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import type { PeerSessionView } from "../../core/plugin.ts";
import type * as PeerState from "../../core/state/PeerState.ts";
import type * as PeerWork from "../../core/work/PeerWork.ts";
import { checkoutKind } from "../../core/vcs.ts";
import type { Jj } from "./client/jj.ts";
import type { Other, Place } from "./verdicts.ts";

/** What Peer keeps of a workspace an agent session worked in. */
export const Workspace = Schema.Struct({
  /** The repository's default workspace; workspaces that share it share aliases. */
  repo: Schema.String,
  /** False in the default workspace, where Peer writes no configuration. */
  configured: Schema.Boolean,
  email: Schema.String,
  name: Schema.String,
  agent: Schema.String,
  task: Schema.optional(Schema.String),
  bookmark: Schema.optional(Schema.String),
  /** The session's own changes (`MINE_MAX` at most). */
  mine: Schema.Array(Schema.String),
  /** The `user.*` keys Peer wrote because jj had none. */
  keys: Schema.Array(Schema.String),
});
export type Workspace = typeof Workspace.Type;
export const Data = Schema.Struct({
  protection: Schema.optional(Schema.Boolean),
  /** By workspace root. */
  workspaces: Schema.Record(Schema.String, Workspace),
});
export type Data = typeof Data.Type;
export const EMPTY: Data = { workspaces: {} };

/** A jj checkout this plugin works in; `own` is any workspace but the repository's default. */
export interface Found {
  readonly root: string;
  readonly repo: string;
  readonly own: boolean;
}

/**
 * What `session.local` keeps: the hook's fallback, the changes with two versions, and following's
 * clock: when bookmarks were fetched, and the commit each followed bookmark was last seen at.
 */
export interface Here extends Place {
  twoVersions: Set<string>;
  commit: string | undefined;
  fetchedAt: number;
  fetched: Map<string, number>;
  known: Map<string, string>;
}

/** The other workspaces' changes of the repository, which a workspace's `peer_others()` holds. */
export const othersIds = (data: Data, root: string, repo: string) => [
  ...new Set(
    Object.entries(data.workspaces).flatMap(([other, one]) =>
      other !== root && one.repo === repo ? one.mine : [],
    ),
  ),
];

export const makePlaces = (
  jj: Jj,
  state: PeerState.PeerState["Service"],
  agents: PeerAgents.PeerAgents["Service"],
  work: PeerWork.PeerWork["Service"],
) => {
  const store = state.pluginData("jujutsu", Data);
  const read = store.read.pipe(Effect.map(Option.getOrElse(() => EMPTY)));
  const write = (change: (data: Data) => Data) =>
    store.update((now) => change(Option.getOrElse(now, () => EMPTY))).pipe(Effect.ignore);
  const update = (root: string, change: (one: Workspace) => Workspace) =>
    write((now) => {
      const one = now.workspaces[root];
      return one === undefined
        ? now
        : { ...now, workspaces: { ...now.workspaces, [root]: change(one) } };
    });

  const placeOf = (cwd: string) =>
    Effect.tryPromise(() => checkoutKind(cwd)).pipe(
      Effect.map((kind): Found | null =>
        kind?.kind === "jj"
          ? { root: kind.root, repo: kind.mainRoot, own: kind.root !== kind.mainRoot }
          : null,
      ),
      Effect.orElseSucceed(() => null),
    );

  /** The key people call a task by; the id when the Hub has no key for it. */
  const taskKey = (
    workspace: string,
    project: string,
    task: string | undefined,
  ): Effect.Effect<string | undefined> =>
    task === undefined
      ? Effect.succeed(undefined)
      : work.tasks(workspace, project).pipe(
          Effect.map((tasks) => {
            const found = tasks.find((one) => one.id === task || one.key === task);
            return found?.key ?? found?.id ?? task;
          }),
        );

  /** Other sessions' changes a command could name: this computer's workspaces, teammates' bookmarks. */
  const othersOf = (session: PeerSessionView, found: Found) =>
    Effect.gen(function* () {
      const local = Object.entries((yield* read).workspaces)
        .filter(([root, one]) => root !== found.root && one.repo === found.repo)
        .map(([, one]): Other => ({
          ids: one.mine,
          bookmark: one.bookmark,
          owner: { person: one.name, task: one.task },
        }));
      const remote: Array<Other> = [];
      for (const thread of yield* work.threads(session.workspace, session.project))
        if (thread.environment !== state.environmentId && thread.branch !== undefined)
          remote.push({
            ids: [],
            bookmark: thread.branch,
            owner: {
              person: state.nameOf(session.workspace, thread.email),
              task: yield* taskKey(session.workspace, session.project, thread.task),
            },
          });
      return [...local, ...remote];
    });

  const hereOf = (session: PeerSessionView) =>
    session.local<Here>("jujutsu", () => ({
      jj: false,
      others: [],
      twoVersions: new Set(),
      commit: undefined,
      fetchedAt: 0,
      fetched: new Map(),
      known: new Map(),
    }));

  return {
    jj,
    state,
    agents,
    work,
    log: agents.log,
    read,
    write,
    update,
    placeOf,
    taskKey,
    othersOf,
    hereOf,
    /** The session's own change ids and those of the repository's other workspaces. */
    ids: (found: Found) =>
      read.pipe(
        Effect.map((data) => ({
          mine: data.workspaces[found.root]?.mine ?? [],
          others: othersIds(data, found.root, found.repo),
        })),
      ),
  };
};

export type Places = ReturnType<typeof makePlaces>;
