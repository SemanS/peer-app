/**
 * hubApi — the Peer Hub's HTTP API. Signing in mails a one-time code to the
 * person's address; every later call carries the session it returns.
 *
 * Core's endpoints live here, its coordination ones in `coordApi.ts`; a plugin's are in its own
 * `hub.ts`, built on `request`.
 *
 * @module peerHub/core/hub/hubApi
 */
import {
  PeerFoundWorkspace,
  PeerDomainOffer,
  PeerDomainState,
  PeerRemovedWorkspace,
  PeerHubError,
  type PeerHubFailureKind,
  PeerManifest,
  PeerTask,
  PeerWorkThread,
  PeerWorkPullRequest,
  PeerWorkspaceRole,
  PeerWorkStatus,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Sse from "effect/unstable/encoding/Sse";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { accessApi } from "./accessApi.ts";
import { coordinationApi } from "./coordApi.ts";

const isDomainState = Schema.is(PeerDomainState);

const SignInStarted = Schema.Struct({
  email: Schema.String,
  sent: Schema.Boolean,
  /** Only from a hub running with PEERHUB_MAIL=echo (local development and tests). */
  code: Schema.optional(Schema.String),
});

const SignInFinished = Schema.Struct({
  session: Schema.String,
  email: Schema.String,
  expiresAt: Schema.String,
});

const WorkspaceSummary = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  allowedDomains: Schema.Array(Schema.String),
});

const Me = Schema.Struct({
  email: Schema.String,
  removed: Schema.optional(Schema.Array(PeerRemovedWorkspace)),
  workspaces: Schema.Array(
    Schema.Struct({
      ...WorkspaceSummary.fields,
      role: PeerWorkspaceRole,
      domainClaims: Schema.optional(
        Schema.Array(Schema.Struct({ domain: Schema.String, state: Schema.String })),
      ),
    }),
  ),
  domainOffers: Schema.optional(Schema.Array(PeerDomainOffer)),
  joinable: Schema.Array(
    Schema.Struct({
      ...WorkspaceSummary.fields,
      // This value set is closed on every shipped Peer; new offers are a separate field.
      joinReason: Schema.Literals(["domain", "invite"]),
    }),
  ),
  /** The features this Hub serves, by id, with their revisions; a Hub from before the catalog sends none. */
  features: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
  /** The features its operator turned off (they are not in `features`); older Hubs do not say. */
  featuresOff: Schema.optional(Schema.Array(Schema.String)),
  /** The Hub's build; older Hubs do not say. */
  hub: Schema.optional(
    Schema.Struct({
      version: Schema.optional(Schema.String),
      commit: Schema.optional(Schema.String),
    }),
  ),
});
export type HubMe = Omit<typeof Me.Type, "workspaces"> & {
  readonly workspaces: ReadonlyArray<
    Omit<(typeof Me.Type)["workspaces"][number], "domainClaims"> & {
      readonly domainClaims?:
        | ReadonlyArray<{ readonly domain: string; readonly state: typeof PeerDomainState.Type }>
        | undefined;
    }
  >;
};

const WorkResponse = Schema.Struct({
  projects: Schema.Record(
    Schema.String,
    Schema.Struct({
      areas: Schema.Array(Schema.String),
      tasks: Schema.Array(PeerTask),
      threads: Schema.Array(PeerWorkThread),
    }),
  ),
});
export type HubWork = typeof WorkResponse.Type;

export interface ReportedThread {
  readonly id: string;
  readonly project: string;
  readonly task?: string;
  readonly title: string;
  readonly status: PeerWorkStatus;
  readonly harness?: string;
  readonly branch?: string;
  /** The same work under a new branch name, explicitly recorded by automatic launch naming. */
  readonly branchRenamedFrom?: string;
  readonly source: "peer" | "herdr";
  /** Its owner lets the project's members watch it live. */
  readonly observable?: boolean;
  readonly runtimePresent?: boolean;
  readonly previousId?: string;
  readonly repository?: string;
  readonly pullRequests?: ReadonlyArray<PeerWorkPullRequest>;
}

const Ok = Schema.Struct({});
const ErrorBody = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.String,
    details: Schema.optional(Schema.Unknown),
  }),
});
const decodeErrorBody = Schema.decodeUnknownOption(ErrorBody);

const SESSION_ENDED = "Your session with the hub ended. Sign in again.";

/** The hub no longer accepts the stored session (signed out elsewhere, expired). */
export const SIGN_IN_FIRST = "Sign in first.";
export const isSignedOut = (error: { readonly detail: string }) =>
  error.detail === SIGN_IN_FIRST || error.detail === SESSION_ENDED;

export const isSessionEnded = (error: PeerHubError) => error.detail === SESSION_ENDED;

/** What the Hub's router says of a path it has no route for. */
const NO_SUCH_ROUTE = "no such route";

/**
 * The Hub has no route for the call: it predates the feature or runs without it. A Hub that has
 * the route answers a miss in its own words, with a code; one that does not says so with its
 * router's message, or an older one with a bare 404 that something in front of it may have sent.
 */
export const isMissingRoute = (error: PeerHubError) =>
  error.status === 404 && (error.code === undefined || error.detail === NO_SUCH_ROUTE);

/** How long a call waits for the Hub when its caller does not say. */
const WAIT_MS = 20_000;

/**
 * One change ping of a workspace's event stream, as the Hub names it: `work`, `coord`, `projects`
 * and `resync` (pings it missed) for core, and each feature's own (`requests`, `observe`, ...).
 * Content-free: its fields are ids and counters, like the computer and thread `observe` names.
 */
export interface HubPing {
  readonly change: string;
  /** The environment whose report caused it, so that environment can skip its own echo. */
  readonly origin: string | null;
  /** Its other scalar fields. */
  readonly data: Readonly<Record<string, string | number | boolean | null>>;
}

const decodePingFields = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

/** A ping's fields other than `origin`, without the nested ones a ping should not carry. */
function scalarFields(fields: Readonly<Record<string, unknown>>): HubPing["data"] {
  const data: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key === "origin") continue;
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      data[key] = value;
    }
  }
  return data;
}

const NO_EVENTS = "The hub sends no change events.";
/** The hub predates push (or the workspace is not the caller's): ask again much later. */
export const isWithoutEvents = (error: PeerHubError) => error.detail === NO_EVENTS;

const isPeerHubError = Schema.is(PeerHubError);

/** The hub's keep-alive comes every 20 s; this long without a byte means the stream is gone. */
const EVENTS_SILENT_AFTER = "70 seconds";

const segment = (value: string) => encodeURIComponent(value);

/** What a server-sent event stream that fails says, by what went wrong. */
export interface EventStreamTexts {
  /** The Hub has no such stream (404). */
  readonly notFound: string;
  /** The Hub refused it otherwise, with this HTTP status. */
  readonly refused: (status: number) => string;
  /** It went silent past the Hub's keep-alive. */
  readonly silent: string;
  /** It broke off. */
  readonly broken: string;
}

/** A schema `request` decodes the Hub's answer with. */
export type HubAnswer = Schema.Top & { readonly DecodingServices: never };

/** One call to the Hub. */
export interface HubRequest<Missing> {
  readonly hubUrl: string;
  readonly path: string;
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly session?: string | undefined;
  readonly body?: unknown;
  /** What a 404 means instead of an error, e.g. "no such workspace". */
  readonly notFound?: { readonly value: Missing };
  /**
   * What a hub without this route means: it answers 404, or 405 where the path exists for other
   * methods, often with no JSON at all.
   */
  readonly unsupported?: {
    readonly value: Missing;
    readonly when?: (status: number, message: string) => boolean;
  };
  /** What a 409 means instead of an error, from its code and details; undefined: an error. */
  readonly conflict?: (code: string, details: unknown) => Missing | undefined;
  /**
   * What a 403 or 422 means instead of an error, from its status, code and details (the paths a
   * change may not touch, the diagnostics of one that is invalid); undefined: an error. Only a
   * caller that asks hears the details, so every other refusal stays what it was.
   */
  readonly rejected?: (status: 403 | 422, code: string, details: unknown) => Missing | undefined;
  /** How long to wait for the hub to answer, in milliseconds; 20 seconds when absent. */
  readonly timeoutMs?: number;
}

/** A call to the Hub, as `request` makes it: its answer decoded, or what `input` says a miss means. */
export type HubCall = <S extends HubAnswer, Missing = never>(
  schema: S,
  input: HubRequest<Missing>,
) => Effect.Effect<S["Type"] | Missing, PeerHubError>;

export const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;

  const request = <S extends HubAnswer, Missing = never>(
    schema: S,
    input: HubRequest<Missing>,
  ): Effect.Effect<S["Type"] | Missing, PeerHubError> => {
    const waitMs = input.timeoutMs ?? WAIT_MS;
    /** A failure of this call: its message as ever, and where the call stopped. */
    const stopped = (
      kind: PeerHubFailureKind,
      detail: string,
      more: {
        readonly code?: string;
        readonly refused?: boolean;
        readonly status?: number;
        readonly waitedMs?: number;
      } = {},
    ) =>
      new PeerHubError({
        detail,
        kind,
        hubUrl: input.hubUrl,
        request: `${input.method ?? "GET"} ${input.path}`,
        ...more,
      });
    return Effect.gen(function* () {
      const url = `${input.hubUrl.replace(/\/+$/, "")}${input.path}`;
      const base =
        input.method === "POST"
          ? HttpClientRequest.post(url)
          : input.method === "PUT"
            ? HttpClientRequest.put(url)
            : input.method === "PATCH"
              ? HttpClientRequest.patch(url)
              : input.method === "DELETE"
                ? HttpClientRequest.delete(url)
                : HttpClientRequest.get(url);
      const withAuth =
        input.session === undefined
          ? base
          : base.pipe(HttpClientRequest.setHeader("Authorization", `Bearer ${input.session}`));
      const prepared =
        input.body === undefined
          ? withAuth
          : withAuth.pipe(HttpClientRequest.bodyJsonUnsafe(input.body));
      const response = yield* client
        .execute(prepared)
        .pipe(
          Effect.mapError(() =>
            stopped("unreachable", `Could not reach the hub at ${input.hubUrl}.`),
          ),
        );
      if (
        input.unsupported !== undefined &&
        (response.status === 405 ||
          (response.status === 404 && input.unsupported.when === undefined))
      ) {
        return input.unsupported.value;
      }
      const refusedByStatus = response.status >= 400 && response.status < 500;
      const json = yield* response.json.pipe(
        Effect.mapError(() =>
          stopped(
            // An error status with no JSON is still the Hub's (or what fronts it) refusing.
            response.status >= 300 ? "refused" : "invalid",
            `The hub answered ${input.path} with something other than JSON.`,
            { status: response.status, ...(refusedByStatus ? { refused: true } : {}) },
          ),
        ),
      );
      if (response.status === 404 && input.unsupported?.when !== undefined) {
        const error = decodeErrorBody(json);
        if (
          error._tag === "Some" &&
          input.unsupported.when(response.status, error.value.error.message)
        )
          return input.unsupported.value;
      }
      if (response.status === 404 && input.notFound !== undefined) return input.notFound.value;
      if (response.status < 200 || response.status >= 300) {
        const decoded = decodeErrorBody(json);
        if (response.status === 409 && input.conflict !== undefined && decoded._tag === "Some") {
          const meant = input.conflict(decoded.value.error.code, decoded.value.error.details);
          if (meant !== undefined) return meant;
        }
        const refusedStatus = response.status;
        if (
          (refusedStatus === 403 || refusedStatus === 422) &&
          input.rejected !== undefined &&
          decoded._tag === "Some"
        ) {
          const meant = input.rejected(
            refusedStatus,
            decoded.value.error.code,
            decoded.value.error.details,
          );
          if (meant !== undefined) return meant;
        }
        if (
          response.status === 401 &&
          decoded._tag === "Some" &&
          decoded.value.error.code === "unauthenticated"
        ) {
          return yield* stopped("signedOut", SESSION_ENDED, {
            refused: true,
            code: decoded.value.error.code,
            status: response.status,
          });
        }
        return yield* stopped(
          "refused",
          decoded._tag === "Some"
            ? decoded.value.error.message
            : `The hub refused ${input.path} (HTTP ${response.status}).`,
          {
            status: response.status,
            ...(decoded._tag === "Some" ? { code: decoded.value.error.code } : {}),
            ...(refusedByStatus ? { refused: true } : {}),
          },
        );
      }
      return yield* Schema.decodeUnknownEffect(schema)(json).pipe(
        Effect.mapError(() =>
          stopped("invalid", `The hub's answer to ${input.path} has an unexpected shape.`, {
            status: response.status,
          }),
        ),
      );
    }).pipe(
      // A Hub can send headers while its JSON reply still stalls. Bound the whole call.
      Effect.timeout(waitMs),
      Effect.catchTag("TimeoutError", () =>
        Effect.fail(
          stopped("unreachable", `Could not reach the hub at ${input.hubUrl}.`, {
            waitedMs: waitMs,
          }),
        ),
      ),
    );
  };

  /**
   * A server-sent event stream on the session. `connected` runs once the Hub answered, before the
   * first event. Ends when the Hub closes it; fails, saying what `texts` say, when the Hub refuses
   * it or it goes silent past the Hub's keep-alive.
   */
  const eventStream = (
    hubUrl: string,
    session: string,
    path: string,
    texts: EventStreamTexts,
    connected?: Effect.Effect<void>,
  ): Stream.Stream<Sse.Event, PeerHubError> =>
    client
      .execute(
        HttpClientRequest.get(`${hubUrl.replace(/\/+$/, "")}${path}`).pipe(
          HttpClientRequest.setHeader("Authorization", `Bearer ${session}`),
          HttpClientRequest.setHeader("Accept", "text/event-stream"),
        ),
      )
      .pipe(
        Effect.mapError(
          () => new PeerHubError({ detail: `Could not reach the hub at ${hubUrl}.` }),
        ),
        Effect.filterOrFail(
          (response) => response.status === 200,
          (response) =>
            new PeerHubError({
              detail:
                response.status === 404
                  ? texts.notFound
                  : response.status === 401
                    ? SESSION_ENDED
                    : texts.refused(response.status),
            }),
        ),
        // What is read now is current from the moment the Hub subscribed, on every reconnection.
        Effect.tap(() => connected ?? Effect.void),
        Effect.map((response) =>
          response.stream.pipe(
            Stream.timeoutOrElse({
              duration: EVENTS_SILENT_AFTER,
              orElse: () => Stream.fail(new PeerHubError({ detail: texts.silent })),
            }),
            Stream.decodeText,
            Stream.pipeThroughChannel(Sse.decode()),
            Stream.mapError((error) =>
              isPeerHubError(error) ? error : new PeerHubError({ detail: texts.broken }),
            ),
          ),
        ),
        Stream.unwrap,
      );

  const workspacePath = (slug: string, rest = "") => `/v1/workspaces/${segment(slug)}${rest}`;
  const projectPath = (slug: string, projectId: string, rest: string) =>
    workspacePath(slug, `/projects/${segment(projectId)}${rest}`);

  return {
    /** Any call to the Hub; plugins build their own endpoints on it. */
    request,
    /** Any server-sent event stream of the Hub; plugins build their own on it. */
    eventStream,

    startSignIn: (hubUrl: string, email: string) =>
      request(SignInStarted, {
        hubUrl,
        path: "/v1/auth/email/start",
        method: "POST",
        body: { email },
      }),

    finishSignIn: (hubUrl: string, email: string, code: string) =>
      request(SignInFinished, {
        hubUrl,
        path: "/v1/auth/email/verify",
        method: "POST",
        body: { email, code },
      }),

    signOut: (hubUrl: string, session: string) =>
      request(Ok, { hubUrl, path: "/v1/auth/signout", method: "POST", session, body: {} }),

    me: (hubUrl: string, session: string) =>
      request(Me, { hubUrl, path: "/v1/me", session }).pipe(
        Effect.map((me) => ({
          ...me,
          workspaces: me.workspaces.map(({ domainClaims, ...w }) => ({
            ...w,
            ...(domainClaims === undefined
              ? {}
              : {
                  domainClaims: domainClaims.filter(
                    (c): c is { domain: string; state: typeof PeerDomainState.Type } =>
                      isDomainState(c.state),
                  ),
                }),
          })),
        })),
      ),

    createWorkspace: (
      hubUrl: string,
      session: string,
      body: {
        readonly slug: string;
        readonly name: string;
        readonly allowedDomains: ReadonlyArray<string>;
      },
    ) =>
      request(WorkspaceSummary, {
        hubUrl,
        path: "/v1/workspaces",
        method: "POST",
        session,
        body,
      }),

    /** A workspace by its short name, or null when there is none. */
    findWorkspace: (hubUrl: string, session: string, slug: string) =>
      request(PeerFoundWorkspace, {
        hubUrl,
        path: workspacePath(slug),
        session,
        notFound: { value: null },
      }),

    join: (hubUrl: string, session: string, slug: string, confirmDomainMatch = false) =>
      request(Ok, {
        hubUrl,
        path: workspacePath(slug, "/join"),
        method: "POST",
        session,
        body: confirmDomainMatch ? { confirmDomainMatch: true } : {},
      }),

    leave: (hubUrl: string, session: string, slug: string) =>
      request(Ok, {
        hubUrl,
        path: workspacePath(slug, "/leave"),
        method: "POST",
        session,
        body: {},
      }),

    invite: (
      hubUrl: string,
      session: string,
      slug: string,
      body: { readonly email: string; readonly role: "admin" | "member" },
    ) =>
      request(Ok, {
        hubUrl,
        path: workspacePath(slug, "/invites"),
        method: "POST",
        session,
        body,
      }),

    manifest: (hubUrl: string, session: string, slug: string) =>
      request(PeerManifest, { hubUrl, path: workspacePath(slug, "/manifest"), session }),

    /** Every project of the workspace the caller is on: areas, tasks and recent threads. */
    work: (hubUrl: string, session: string, slug: string) =>
      request(WorkResponse, { hubUrl, path: workspacePath(slug, "/work"), session }),

    /** This environment's threads, replacing what it reported before. */
    reportThreads: (
      hubUrl: string,
      session: string,
      slug: string,
      body: { readonly environment: string; readonly threads: ReadonlyArray<ReportedThread> },
    ) =>
      request(Ok, {
        hubUrl,
        path: workspacePath(slug, "/threads"),
        method: "PUT",
        session,
        body,
      }),

    ...coordinationApi(request, workspacePath),
    ...accessApi(request),

    createTask: (
      hubUrl: string,
      session: string,
      slug: string,
      projectId: string,
      body: { readonly title: string; readonly key?: string; readonly area?: string },
    ) =>
      request(PeerTask, {
        hubUrl,
        path: projectPath(slug, projectId, "/tasks"),
        method: "POST",
        session,
        body,
      }),

    updateTask: (
      hubUrl: string,
      session: string,
      slug: string,
      projectId: string,
      taskId: string,
      body: {
        readonly title?: string;
        readonly area?: string;
        readonly status?: "open" | "review" | "done";
        readonly session?: string;
        readonly environment?: string;
        readonly op?: string;
      },
    ) =>
      request(PeerTask, {
        hubUrl,
        path: projectPath(slug, projectId, `/tasks/${segment(taskId)}`),
        method: "PATCH",
        session,
        body,
      }),

    deleteTask: (
      hubUrl: string,
      session: string,
      slug: string,
      projectId: string,
      taskId: string,
    ) =>
      request(Ok, {
        hubUrl,
        path: projectPath(slug, projectId, `/tasks/${segment(taskId)}`),
        method: "DELETE",
        session,
      }),

    /** Shares a repository with the whole workspace as a project. */
    shareProject: (
      hubUrl: string,
      session: string,
      slug: string,
      body: {
        readonly id: string;
        readonly name: string;
        readonly repositories: ReadonlyArray<{
          readonly id: string;
          readonly url: string;
          readonly branch: string;
        }>;
        readonly areas: ReadonlyArray<string>;
      },
    ) =>
      request(Ok, {
        hubUrl,
        path: workspacePath(slug, "/projects"),
        method: "POST",
        session,
        body,
      }),

    unshareProject: (hubUrl: string, session: string, slug: string, projectId: string) =>
      request(Ok, {
        hubUrl,
        path: workspacePath(slug, `/projects/${segment(projectId)}`),
        method: "DELETE",
        session,
      }),

    /**
     * The workspace's change pings as they come. Ends when the hub closes the
     * stream (it does every 15 minutes); fails when the hub refuses it or the
     * stream goes silent past the hub's keep-alive. `connected` runs once the
     * hub subscribed the caller, before the first ping.
     */
    events: (
      hubUrl: string,
      session: string,
      slug: string,
      connected?: Effect.Effect<void>,
    ): Stream.Stream<HubPing, PeerHubError> =>
      eventStream(
        hubUrl,
        session,
        workspacePath(slug, "/events"),
        {
          notFound: NO_EVENTS,
          refused: (status) => `The hub refused its event stream (HTTP ${status}).`,
          silent: "The hub's event stream went silent.",
          broken: "The hub's event stream broke off.",
        },
        connected,
      ).pipe(
        Stream.map((event): HubPing | null => {
          // Every named event is a ping; who follows it is the follower's business.
          if (event.event === "" || event.event === "message") return null;
          const fields = Option.getOrElse(
            decodePingFields(event.data),
            (): Readonly<Record<string, unknown>> => ({}),
          );
          return {
            change: event.event,
            origin: typeof fields.origin === "string" ? fields.origin : null,
            data: scalarFields(fields),
          };
        }),
        Stream.filter((ping): ping is HubPing => ping !== null),
      ),
  };
});

/** The Hub's HTTP API, as `make` builds it. */
export type HubApi = Effect.Success<typeof make>;
