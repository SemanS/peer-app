/**
 * The Hub's coordination API: this environment's agent sessions and their overlaps, the Hub's
 * decision on an agent's intent to change files, and the versioned shared contexts of work with the
 * reads that pin them. Core's Hub client offers these beside its other endpoints (`hubApi.ts`).
 *
 * @module peerHub/core/hub/coordApi
 */
import {
  PeerContextRead,
  PeerFindingDecision,
  type PeerFindingDecisionInput,
  PeerCoordEvent,
  PeerIntentRequest,
  PeerIntentResponse,
  PeerOverlapRecord,
  PeerStaleReads,
  PeerWorkStatus,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { HubCall } from "./hubApi.ts";

const HubCoordSession = Schema.Struct({
  id: Schema.String,
  runtimeGeneration: Schema.optional(Schema.String),
  project: Schema.String,
  email: Schema.String,
  environment: Schema.String,
  label: Schema.String,
  agent: Schema.optional(Schema.String),
  task: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  status: PeerWorkStatus,
  intent: Schema.optional(Schema.String),
  files: Schema.Array(Schema.String),
  claims: Schema.Array(Schema.String),
  seenAt: Schema.String,
  /** When its agent last did something; a hub from before activity times has none. */
  activeAt: Schema.optional(Schema.String),
});
export type HubCoordSession = typeof HubCoordSession.Type;

const HubOverlap = PeerOverlapRecord;
export type HubOverlap = typeof HubOverlap.Type;

export const HubFinding = Schema.Struct({
  decision: Schema.optional(PeerFindingDecision),
  id: Schema.String,
  project: Schema.String,
  task: Schema.optional(Schema.String),
  text: Schema.String,
  email: Schema.String,
  session: Schema.String,
  environment: Schema.String,
  at: Schema.String,
  /** `project` when its agent marked it as holding beyond its task. */
  scope: Schema.optional(Schema.Literals(["task", "project"])),
});
export type HubFinding = typeof HubFinding.Type;

const HubContextKeeper = Schema.Struct({
  session: Schema.String,
  email: Schema.String,
  environment: Schema.String,
  since: Schema.String,
  epoch: Schema.optional(Schema.Number),
});
export type HubContextKeeper = typeof HubContextKeeper.Type;

/** A task's (or a project's) shared context and who keeps it, without its text. */
const HubContext = Schema.Struct({
  project: Schema.String,
  scope: Schema.String,
  version: Schema.Number,
  epoch: Schema.optional(Schema.Number),
  keeper: Schema.optional(HubContextKeeper),
  updatedAt: Schema.String,
  updatedBy: Schema.optional(Schema.String),
  updatedSession: Schema.optional(Schema.String),
  restoredFrom: Schema.optional(Schema.Number),
  gist: Schema.optional(Schema.String),
  bytes: Schema.optional(Schema.Number),
});
export type HubContext = typeof HubContext.Type;

/** A kept version of a shared context, without its text. */
const HubContextVersion = Schema.Struct({
  version: Schema.Number,
  at: Schema.String,
  by: Schema.optional(Schema.String),
  session: Schema.optional(Schema.String),
  restoredFrom: Schema.optional(Schema.Number),
  bytes: Schema.Number,
  added: Schema.Number,
  dropped: Schema.Number,
});
export type HubContextVersion = typeof HubContextVersion.Type;

export const HubContextVersionText = Schema.Struct({
  version: Schema.Number,
  at: Schema.String,
  by: Schema.optional(Schema.String),
  session: Schema.optional(Schema.String),
  restoredFrom: Schema.optional(Schema.Number),
  added: Schema.Array(Schema.String),
  dropped: Schema.Array(Schema.String),
  text: Schema.String,
});
export type HubContextVersionText = typeof HubContextVersionText.Type;

export const HubContextText = Schema.Struct({ ...HubContext.fields, text: Schema.String });
export type HubContextText = typeof HubContextText.Type;

/** Why the hub would not let a session keep or write a context. */
export type ContextRefusal =
  | { readonly refused: "kept"; readonly keeper: HubContextKeeper | undefined }
  | { readonly refused: "stale"; readonly current: HubContextText };

const KeeperDetails = Schema.Struct({ keeper: Schema.optional(Schema.NullOr(HubContextKeeper)) });
const decodeKeeperDetails = Schema.decodeUnknownOption(KeeperDetails);
const decodeContextText = Schema.decodeUnknownOption(HubContextText);

const CoordView = Schema.Struct({
  sessions: Schema.Array(HubCoordSession),
  overlaps: Schema.Array(HubOverlap),
  /** A hub from before findings has none. */
  findings: Schema.optional(Schema.Array(HubFinding)),
  /** Nor before shared contexts. */
  contexts: Schema.optional(Schema.Array(HubContext)),
  /** How many knowledge candidates wait for people, per project: the Hub's knowledge feature adds it. */
  candidates: Schema.optional(
    Schema.Array(Schema.Struct({ project: Schema.String, proposed: Schema.Number })),
  ),
  /**
   * The policy each project sets (see `PeerProjectPolicy`); a project without one is not listed, and a
   * hub from before project policies sends none. Read with `projectPolicy`: a newer hub may name a policy
   * this Peer does not know, which must not cost it the whole view.
   */
  policies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  at: Schema.String,
});

export type HubCoordView = typeof CoordView.Type;

export type HubIntentRequest = PeerIntentRequest;
export type HubIntentAnswer = PeerIntentResponse;
export type HubIntentVerdict = PeerIntentResponse["verdicts"][number];

/** What an answer is when the hub has no such route: a hub from before it. Not an error. */
export interface HubUnsupported {
  readonly unsupported: true;
}
const UNSUPPORTED: HubUnsupported = { unsupported: true };
export const isUnsupported = (answer: object): answer is HubUnsupported => "unsupported" in answer;

/** One agent session as this environment reports it for coordination. */
export interface ReportedSession {
  readonly id: string;
  readonly runtimeGeneration?: string;
  readonly project: string;
  readonly label: string;
  readonly agent?: string;
  readonly task?: string;
  readonly branch?: string;
  readonly status: PeerWorkStatus;
  readonly intent?: string;
  readonly files: ReadonlyArray<string>;
  readonly claims: ReadonlyArray<string>;
  /** The "For the team" lines of its working context. */
  readonly findings?: ReadonlyArray<string>;
  /** When its agent last did something: an idle keeper gives way to an agent at work. */
  readonly activeAt?: string;
  /** The findings it heard: saying one of them again is no independent discovery. */
  readonly heard?: ReadonlyArray<string>;
}

const segment = (value: string) => encodeURIComponent(value);

/** The coordination endpoints, called with `request` on the Hub's routes below `workspacePath`. */
export const coordinationApi = (
  request: HubCall,
  workspacePath: (slug: string, rest?: string) => string,
) => ({
  /** The agent sessions at work on the caller's projects and their overlaps. */
  coordination: (hubUrl: string, session: string, slug: string) =>
    request(CoordView, { hubUrl, path: workspacePath(slug, "/coord"), session }),

  /** This environment's agent sessions, replacing what it reported before; answers the view. */
  reportCoordination: (
    hubUrl: string,
    session: string,
    slug: string,
    body: { readonly environment: string; readonly sessions: ReadonlyArray<ReportedSession> },
  ) =>
    request(CoordView, {
      hubUrl,
      path: workspacePath(slug, "/coord"),
      method: "PUT",
      session,
      body,
    }),

  noteOverlap: (
    hubUrl: string,
    session: string,
    slug: string,
    project: string,
    overlap: string,
    body: { readonly session?: string; readonly text: string; readonly op?: string },
  ) =>
    request(HubOverlap, {
      hubUrl,
      path: workspacePath(slug, `/coord/${segment(project)}/${segment(overlap)}/notes`),
      method: "POST",
      session,
      body,
    }),

  resolveOverlap: (
    hubUrl: string,
    session: string,
    slug: string,
    project: string,
    overlap: string,
    body: { readonly session?: string; readonly resolution: string; readonly op?: string },
  ) =>
    request(HubOverlap, {
      hubUrl,
      path: workspacePath(slug, `/coord/${segment(project)}/${segment(overlap)}/resolve`),
      method: "POST",
      session,
      body,
    }),

  /**
   * An agent about to change files asks the hub, which registers it as their holder and decides in
   * one step (see `PeerIntentResponse`). Unsupported: a hub from before it. Fails when the hub does
   * not answer within `timeoutMs`, or refuses.
   */
  intent: (
    hubUrl: string,
    session: string,
    slug: string,
    project: string,
    body: PeerIntentRequest,
    options: { readonly timeoutMs?: number } = {},
  ) =>
    request(PeerIntentResponse, {
      hubUrl,
      path: workspacePath(slug, `/coord/${segment(project)}/intent`),
      method: "POST",
      session,
      body,
      unsupported: { value: UNSUPPORTED },
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    }),

  /** An agent session acknowledges an overlap (a note counts as one too). Unsupported: a hub from before it. */
  ack: (
    hubUrl: string,
    session: string,
    slug: string,
    project: string,
    overlap: string,
    body: { readonly session: string; readonly op?: string; readonly filesAt?: string },
  ) =>
    request(HubOverlap, {
      hubUrl,
      path: workspacePath(slug, `/coord/${segment(project)}/${segment(overlap)}/ack`),
      method: "POST",
      session,
      body,
      unsupported: { value: UNSUPPORTED },
    }),

  /** A task's shared context with its text, or null when it has none. */
  readContext: (hubUrl: string, session: string, slug: string, project: string, scope: string) =>
    request(HubContextText, {
      hubUrl,
      path: workspacePath(slug, `/contexts/${segment(project)}/${segment(scope)}`),
      session,
      notFound: { value: null },
    }),

  /** The versions of a shared context the hub keeps, newest first. */
  contextVersions: (
    hubUrl: string,
    session: string,
    slug: string,
    project: string,
    scope: string,
  ) =>
    request(Schema.Array(HubContextVersion), {
      hubUrl,
      path: workspacePath(slug, `/contexts/${segment(project)}/${segment(scope)}/versions`),
      session,
      notFound: { value: [] },
    }),

  /** One kept version with its text, or null when the hub no longer keeps it. */
  contextVersion: (
    hubUrl: string,
    session: string,
    slug: string,
    project: string,
    scope: string,
    version: number,
  ) =>
    request(HubContextVersionText, {
      hubUrl,
      path: workspacePath(
        slug,
        `/contexts/${segment(project)}/${segment(scope)}/versions/${Math.trunc(version)}`,
      ),
      session,
      notFound: { value: null },
    }),

  /** Brings an older version back as a new one, by the person signed in here. */
  restoreContext: (
    hubUrl: string,
    session: string,
    slug: string,
    project: string,
    scope: string,
    version: number,
  ) =>
    request(HubContextText, {
      hubUrl,
      path: workspacePath(slug, `/contexts/${segment(project)}/${segment(scope)}/restore`),
      method: "POST",
      session,
      body: { version: Math.trunc(version) },
    }),

  /**
   * Asks for an agent session to keep a shared context (or, with `release`,
   * gives it up): the context with its text, or who keeps it instead.
   */
  keepContext: (
    hubUrl: string,
    session: string,
    slug: string,
    project: string,
    scope: string,
    body: {
      readonly environment: string;
      readonly session: string;
      readonly release?: boolean;
      readonly epoch?: number;
      readonly op?: string;
    },
  ) =>
    request(HubContextText, {
      hubUrl,
      path: workspacePath(slug, `/contexts/${segment(project)}/${segment(scope)}/keeper`),
      method: "POST",
      session,
      body,
      conflict: (code, details): ContextRefusal | undefined => {
        const keeper = decodeKeeperDetails(details);
        return code === "kept" && keeper._tag === "Some"
          ? { refused: "kept", keeper: keeper.value.keeper ?? undefined }
          : undefined;
      },
    }),

  /** A new version from the session keeping a context, written on `baseVersion`. */
  contextRead: (
    hubUrl: string,
    session: string,
    slug: string,
    project: string,
    scope: string,
    body: {
      readonly session: string;
      readonly environment: string;
      readonly version: number;
      readonly op?: string;
    },
  ) =>
    request(PeerContextRead, {
      hubUrl,
      session,
      method: "POST",
      path: workspacePath(slug, `/contexts/${segment(project)}/${segment(scope)}/read`),
      body,
    }),

  staleReads: (
    hubUrl: string,
    session: string,
    slug: string,
    project: string,
    reader: { readonly session: string; readonly environment: string },
  ) =>
    request(PeerStaleReads, {
      hubUrl,
      session,
      path: workspacePath(
        slug,
        `/coord/${segment(project)}/stale?session=${segment(reader.session)}&environment=${segment(reader.environment)}`,
      ),
    }),

  publishedInputs: (
    hubUrl: string,
    session: string,
    slug: string,
    project: string,
    scope: string,
    version: number,
  ) =>
    request(PeerStaleReads, {
      hubUrl,
      session,
      path: workspacePath(
        slug,
        `/coord/${segment(project)}/stale?scope=${segment(scope)}&version=${version}`,
      ),
    }),

  pendingFindings: (
    hubUrl: string,
    session: string,
    slug: string,
    project: string,
    scope?: string,
    cursor?: string,
    limit?: number,
  ) => {
    const query = [
      scope === undefined ? "" : `scope=${segment(scope)}`,
      cursor === undefined ? "" : `cursor=${segment(cursor)}`,
      limit === undefined ? "" : `limit=${limit}`,
    ]
      .filter(Boolean)
      .join("&");
    return request(
      Schema.Struct({
        findings: Schema.Array(HubFinding),
        nextCursor: Schema.optional(Schema.NullOr(Schema.String)),
        omittedCount: Schema.Number,
        unsupported: Schema.optional(Schema.Boolean),
      }),
      {
        hubUrl,
        session,
        path: workspacePath(slug, `/coord/${segment(project)}/findings?${query}`),
        unsupported: {
          value: { findings: [], omittedCount: 0, unsupported: true },
          when: (_status, message) => message === "no such route",
        },
      },
    );
  },

  recoverInputs: (
    hubUrl: string,
    token: string,
    slug: string,
    project: string,
    body: {
      readonly environment: string;
      readonly session: string;
      readonly reason: string;
      readonly reads: ReadonlyArray<{ readonly scope: string; readonly version: number }>;
      readonly coverage: "new-work" | "reconstructed" | "transferred" | "unavailable";
      readonly op?: string;
    },
  ) =>
    request(PeerStaleReads, {
      hubUrl,
      session: token,
      path: workspacePath(slug, `/coord/${segment(project)}/inputs/recover`),
      method: "POST",
      body,
    }),

  coordEvents: (
    hubUrl: string,
    session: string,
    slug: string,
    project: string,
    filter: { readonly task?: string; readonly path?: string; readonly limit?: number } = {},
  ) => {
    const query = [
      ...(filter.task === undefined ? [] : [`task=${segment(filter.task)}`]),
      ...(filter.path === undefined ? [] : [`path=${segment(filter.path)}`]),
      ...(filter.limit === undefined ? [] : [`limit=${filter.limit}`]),
    ].join("&");
    return request(Schema.Array(PeerCoordEvent), {
      hubUrl,
      session,
      path: workspacePath(
        slug,
        `/coord/${segment(project)}/events${query === "" ? "" : `?${query}`}`,
      ),
    });
  },

  writeContext: (
    hubUrl: string,
    session: string,
    slug: string,
    project: string,
    scope: string,
    body: {
      readonly environment: string;
      readonly session: string;
      readonly baseVersion: number;
      readonly text: string;
      readonly findingDecisions?: ReadonlyArray<PeerFindingDecisionInput>;
      readonly epoch?: number;
      readonly op?: string;
    },
  ) =>
    request(HubContextText, {
      hubUrl,
      path: workspacePath(slug, `/contexts/${segment(project)}/${segment(scope)}`),
      method: "PUT",
      session,
      body,
      conflict: (code, details): ContextRefusal | undefined => {
        if (code === "stale") {
          const current = decodeContextText(details);
          return current._tag === "Some" ? { refused: "stale", current: current.value } : undefined;
        }
        const keeper = decodeKeeperDetails(details);
        return code === "not_keeper" && keeper._tag === "Some"
          ? { refused: "kept", keeper: keeper.value.keeper ?? undefined }
          : undefined;
      },
    }),
});
