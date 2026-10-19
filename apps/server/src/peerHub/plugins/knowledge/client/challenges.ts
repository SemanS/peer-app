/**
 * Knowledge's challenges on the Hub (its `knowledge` feature from revision 2): a project's list,
 * opening or seconding one, deciding one; and the cache of each project's challenges that agents'
 * hooks read without waiting on the Hub. The cache is read again on `coord` pings and on resync,
 * and a failed read keeps the last list.
 *
 * @module peerHub/plugins/knowledge/client/challenges
 */
import { PeerHubError, PeerKnowledgeChallenge, type PeerKeptAs } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { isMissingRoute } from "../../../core/plugin.ts";
import type * as PeerHubClient from "../../../core/hub/PeerHubClient.ts";

/** The knowledge feature's revision that serves challenges. */
export const CHALLENGES_REVISION = 2;

type Challenge = PeerKnowledgeChallenge;
type Status = Challenge["status"];

const pathOf = (project: string, id?: string) =>
  `/challenges/${encodeURIComponent(project)}${id === undefined ? "" : `/${encodeURIComponent(id)}`}`;

const WithFutureState = Schema.Struct({ ...PeerKnowledgeChallenge.fields, status: Schema.String });
const isKnown = Schema.is(PeerKnowledgeChallenge);

const unsupported = (error: PeerHubError) =>
  new PeerHubError({
    detail: "This Hub does not take challenges of knowledge yet.",
    kind: "unsupported",
    refused: true,
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(error.hubUrl === undefined ? {} : { hubUrl: error.hubUrl }),
    ...(error.request === undefined ? {} : { request: error.request }),
  });

export interface DecideBody {
  readonly status: Status;
  readonly resolvedAs?: PeerKeptAs;
  readonly entryRevision?: string;
}

export const challengesHub = (client: PeerHubClient.PeerHubClient["Service"]) => ({
  /** Open first, then the most independent challengers, then the newest; rows of a newer state are left out. */
  list: (workspace: string, project: string) =>
    client.request(Schema.Array(WithFutureState), { workspace, path: pathOf(project) }).pipe(
      Effect.mapError((error) => (isMissingRoute(error) ? unsupported(error) : error)),
      Effect.map((rows): ReadonlyArray<Challenge> => rows.filter(isKnown)),
    ),

  /** A person opens a challenge of an entry, or seconds the one it has. */
  open: (
    workspace: string,
    project: string,
    body: { readonly entry: string; readonly reason: string; readonly entryRevision?: string },
  ) =>
    client.request(PeerKnowledgeChallenge, {
      workspace,
      path: pathOf(project),
      method: "POST",
      body,
    }),

  decide: (workspace: string, project: string, id: string, body: DecideBody) =>
    client.request(PeerKnowledgeChallenge, {
      workspace,
      path: pathOf(project, id),
      method: "POST",
      body,
    }),
});

export type ChallengesHub = ReturnType<typeof challengesHub>;

/** What agents hear of: challenges people have not decided yet. */
export const isOpen = (challenge: Challenge) => challenge.status === "open";

/** The told key of what a session heard of a challenge: said again when more agents join it. */
export const challengeKey = (challenge: Challenge) =>
  `${challenge.entry}#challenge@${challenge.finders}`;

/** Its reasons, newest independent first, each once. */
export function reasonsOf(challenge: Challenge) {
  const seen = new Set<string>();
  return challenge.sources
    .toSorted((a, b) => Number(b.independent) - Number(a.independent) || b.at.localeCompare(a.at))
    .filter((source) => {
      const fresh = source.text !== "" && !seen.has(source.text);
      seen.add(source.text);
      return fresh;
    });
}

/**
 * Each project's challenges as last read, for hooks that may not wait on the Hub. A project is
 * read once something asks for it (`want`), and again on each refresh while the Hub serves them.
 */
export function challengeCache(
  load: (
    workspace: string,
    project: string,
  ) => Effect.Effect<ReadonlyArray<Challenge>, PeerHubError>,
) {
  const lists = new Map<
    string,
    {
      readonly workspace: string;
      readonly project: string;
      list: ReadonlyArray<Challenge>;
      version: number;
    }
  >();
  const reading = new Set<string>();
  const again = new Set<string>();
  const keyOf = (workspace: string, project: string) => `${workspace}\u0000${project}`;

  const read = (key: string): Effect.Effect<void> =>
    Effect.suspend(() => {
      const held = lists.get(key);
      if (held === undefined) return Effect.void;
      if (reading.has(key)) {
        again.add(key);
        return Effect.void;
      }
      reading.add(key);
      return load(held.workspace, held.project).pipe(
        Effect.map((list) => {
          if (JSON.stringify(list) !== JSON.stringify(held.list)) {
            held.list = list;
            held.version += 1;
          }
        }),
        // A Hub that cannot be reached keeps the last list.
        Effect.ignore,
        Effect.ensuring(Effect.sync(() => reading.delete(key))),
        Effect.andThen(Effect.suspend(() => (again.delete(key) ? read(key) : Effect.void))),
      );
    });

  return {
    /** Registers interest in a project; true when it was not known yet. */
    want: (workspace: string, project: string) => {
      const key = keyOf(workspace, project);
      if (lists.has(key)) return false;
      lists.set(key, { workspace, project, list: [], version: 0 });
      return true;
    },
    /** The project's challenges as last read; no I/O. */
    of: (workspace: string, project: string) => lists.get(keyOf(workspace, project))?.list ?? [],
    /** Changes each time the project's list changes. */
    version: (workspace: string, project: string) =>
      lists.get(keyOf(workspace, project))?.version ?? 0,
    put: (workspace: string, project: string, list: ReadonlyArray<Challenge>) => {
      const held = lists.get(keyOf(workspace, project));
      if (held === undefined)
        lists.set(keyOf(workspace, project), { workspace, project, list, version: 1 });
      else if (JSON.stringify(list) !== JSON.stringify(held.list)) {
        held.list = list;
        held.version += 1;
      }
    },
    /** Reads the wanted projects again, of one workspace or all. */
    refresh: (workspace?: string) =>
      Effect.forEach(
        [...lists].filter(([, held]) => workspace === undefined || held.workspace === workspace),
        ([key]) => read(key),
        { discard: true, concurrency: 4 },
      ),
    /** A Hub that stopped serving challenges: agents hear of none. */
    clear: () => {
      for (const held of lists.values()) {
        if (held.list.length > 0) {
          held.list = [];
          held.version += 1;
        }
      }
    },
  };
}

export type ChallengeCache = ReturnType<typeof challengeCache>;

/** What kontext's working read says of a challenged entry now. */
export interface EntryNow {
  readonly file: string;
  readonly title: string;
  readonly kind: string;
  readonly status: string | undefined;
  readonly state: string | undefined;
  readonly revision: string | undefined;
}

const RETIRED = new Set(["superseded", "deprecated"]);
const REVIEWED = new Set(["committed", "reviewed_ref"]);

/**
 * What a refresh of a project's book says to post of its challenges. A challenge resolves only
 * when the entry is superseded or deprecated in a committed or reviewed revision; a staged change
 * alone, or an entry this checkout does not have, says nothing (a person decides then). An open
 * challenge of an entry retired outside Peer goes through `resolving`, as the Hub asks. A
 * challenge raised before anyone knew the entry's revision gets the one this checkout has.
 */
export function challengeUpdates(
  list: ReadonlyArray<Challenge>,
  now: (entry: string) => EntryNow | null | undefined,
): ReadonlyArray<{ readonly id: string; readonly bodies: ReadonlyArray<DecideBody> }> {
  return list.flatMap((challenge) => {
    if (challenge.status !== "open" && challenge.status !== "resolving") return [];
    const entry = now(challenge.entry);
    if (entry === null || entry === undefined) return [];
    if (
      entry.status !== undefined &&
      RETIRED.has(entry.status) &&
      entry.state !== undefined &&
      REVIEWED.has(entry.state)
    ) {
      const resolving: DecideBody = {
        status: "resolving",
        resolvedAs: { path: entry.file, title: entry.title, kind: entry.kind },
      };
      return [
        {
          id: challenge.id,
          bodies:
            challenge.status === "open"
              ? [resolving, { status: "resolved" }]
              : [{ status: "resolved" }],
        },
      ];
    }
    if (challenge.entryRevision !== undefined || entry.revision === undefined) return [];
    if (challenge.status === "resolving" && challenge.resolvedAs === undefined) return [];
    return [
      {
        id: challenge.id,
        bodies: [
          {
            status: challenge.status,
            entryRevision: entry.revision,
            ...(challenge.resolvedAs === undefined ? {} : { resolvedAs: challenge.resolvedAs }),
          },
        ],
      },
    ];
  });
}
