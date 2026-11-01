/**
 * The Hub's coordination API: this environment's agent sessions and their overlaps, and what an
 * agent's intent to change files finds there. Core's Hub client offers these beside its other
 * endpoints (`hubApi.ts`).
 *
 * @module peerHub/core/hub/coordApi
 */
import {
  PeerCoordEvent,
  PeerIntentRequest,
  PeerIntentResponse,
  PeerOverlapRecord,
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
  /** Its run; absent from Peers and Hubs that predate runs. */
  run: Schema.optional(Schema.String),
});
export type HubCoordSession = typeof HubCoordSession.Type;

const HubOverlap = PeerOverlapRecord;
export type HubOverlap = typeof HubOverlap.Type;

const CoordView = Schema.Struct({
  sessions: Schema.Array(HubCoordSession),
  overlaps: Schema.Array(HubOverlap),
  at: Schema.String,
});

export type HubCoordView = typeof CoordView.Type;

export type HubIntentRequest = PeerIntentRequest;
export type HubIntentAnswer = PeerIntentResponse;
export type HubIntentVerdict = PeerIntentResponse["verdicts"][number];

/** One agent session as this environment reports it for coordination. */
export interface ReportedSession {
  readonly id: string;
  readonly runtimeGeneration?: string;
  readonly project: string;
  readonly label: string;
  readonly agent?: string;
  readonly task?: string;
  /** Its run (design D4); a Hub before runs ignores it. */
  readonly run?: string;
  readonly branch?: string;
  readonly status: PeerWorkStatus;
  readonly intent?: string;
  readonly files: ReadonlyArray<string>;
  readonly claims: ReadonlyArray<string>;
  /** When its agent last did something. */
  readonly activeAt?: string;
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

  /**
   * An agent about to change files tells the hub, which registers it as their holder and says who
   * else is on each in one step (see `PeerIntentResponse`). Fails when the hub does not answer
   * within `timeoutMs`, or refuses.
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
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
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
});
