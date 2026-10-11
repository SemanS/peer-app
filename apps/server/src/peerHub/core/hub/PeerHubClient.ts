/**
 * PeerHubClient: this environment's session with its Peer Hub.
 *
 * It keeps the Hub session (a stored secret), signs a person in and out, reads which features the
 * signed-in Hub serves, and makes calls on the session. Plugins reach their own Hub endpoints
 * through `request` and `stream`; core's endpoints are `api`.
 *
 * @module peerHub/core/hub/PeerHubClient
 */
import {
  PeerHubError,
  type PeerHubFinishSignInInput,
  type PeerHubInfo,
  type PeerHubStartSignInInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type * as Sse from "effect/unstable/encoding/Sse";

import * as ServerSecretStore from "../../../auth/ServerSecretStore.ts";
import * as PeerState from "../state/PeerState.ts";
import { EMPTY_PERSISTED, type PersistedState } from "../state/PeerState.ts";
import * as HubApi from "./hubApi.ts";

const SESSION_SECRET = "peer-hub-session";
/** The hub a fresh install signs in to; PEER_HUB_URL points a build or a machine elsewhere. */
const DEFAULT_HUB_URL = process.env.PEER_HUB_URL?.trim() || "https://hub.webinson.com";

/** Feature id → the revision the signed-in Hub serves it at. */
export type HubFeatures = Readonly<Record<string, number>>;

/** What a Hub from before the feature catalog serves. */
export const LEGACY_HUB_FEATURES: HubFeatures = {
  requests: 1,
  observe: 1,
  knowledge: 1,
  memory: 1,
};

/** The features a `/v1/me` answer lists; a Hub without a catalog serves the legacy set. */
export const featuresOf = (me: HubApi.HubMe): HubFeatures => me.features ?? LEGACY_HUB_FEATURES;

/**
 * What a `/v1/me` answer says of the Hub itself: its build, the catalog it serves and the features
 * its operator turned off, each only where the Hub said so; none for a Hub that says nothing of
 * them. The catalog here is the Hub's own words, where `featuresOf` assumes the legacy set.
 */
const hubInfoOf = (me: HubApi.HubMe): PeerHubInfo | undefined => {
  const info: PeerHubInfo = {
    ...(me.hub?.version === undefined ? {} : { version: me.hub.version }),
    ...(me.hub?.commit === undefined ? {} : { commit: me.hub.commit }),
    ...(me.features === undefined ? {} : { features: me.features }),
    ...(me.featuresOff === undefined ? {} : { featuresOff: me.featuresOff }),
  };
  return Object.keys(info).length === 0 ? undefined : info;
};

const sameFeatures = (a: HubFeatures, b: HubFeatures) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

function normalizeHubUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s/]+/i.test(trimmed) ? trimmed : null;
}

const hubError = (detail: string) => new PeerHubError({ detail });

export class PeerHubClient extends Context.Service<
  PeerHubClient,
  {
    /** Core's Hub endpoints (and plugins' until each moves to its own `hub.ts`). */
    readonly api: HubApi.HubApi;
    /** The Hub this environment signs in to. */
    readonly hubUrl: (persisted: PersistedState) => string;
    /** The stored Hub session, if any. */
    readonly storedSession: Effect.Effect<Option.Option<string>>;
    /** The signed-in Hub and its session; fails with "Sign in first." */
    readonly session: Effect.Effect<
      { readonly hubUrl: string; readonly session: string },
      PeerHubError
    >;
    /** A call on the session to `/v1/workspaces/{workspace}{path}`, as plugins' `hub.ts` make. */
    readonly request: <S extends HubApi.HubAnswer, Missing = never>(
      schema: S,
      input: Omit<HubApi.HubRequest<Missing>, "hubUrl" | "session"> & {
        readonly workspace: string;
      },
    ) => Effect.Effect<S["Type"] | Missing, PeerHubError>;
    /**
     * Server-sent events on the session from `/v1/workspaces/{workspace}{path}`, as plugins' `hub.ts`
     * read them; ends when the Hub closes the stream, and fails as `texts` say.
     */
    readonly stream: (input: {
      readonly workspace: string;
      readonly path: string;
      readonly texts: HubApi.EventStreamTexts;
    }) => Stream.Stream<Sse.Event, PeerHubError>;
    /**
     * The features the signed-in Hub serves, as its last `/v1/me` said. Until one is read, and
     * while the Hub cannot be reached, the last value stays: the legacy set at first.
     */
    readonly features: Effect.Effect<HubFeatures>;
    /** The features now, then each change. */
    readonly featureChanges: Stream.Stream<HubFeatures>;
    /**
     * What the signed-in Hub last said of itself in `/v1/me` (`hubInfoOf`), which the status
     * carries for Settings to show. Undefined until one is read and for a Hub that says nothing of
     * itself; it stays while the Hub cannot be reached, and goes with the session.
     */
    readonly hubInfo: Effect.Effect<PeerHubInfo | undefined>;
    /** Who is signed in and their workspaces, from `/v1/me`; keeps the Hub's feature catalog. */
    readonly me: Effect.Effect<HubApi.HubMe, PeerHubError>;
    /** Mails a sign-in code to the address. Run under the state lock. */
    readonly startSignIn: (input: PeerHubStartSignInInput) => Effect.Effect<void, PeerHubError>;
    /** Checks the mailed code, then keeps the session and the address. Run under the state lock. */
    readonly finishSignIn: (
      input: PeerHubFinishSignInInput,
    ) => Effect.Effect<{ readonly email: string; readonly session: string }, PeerHubError>;
    /**
     * Ends the session at the Hub and forgets the person's Hub state here. Which checkouts,
     * threads and plugins belong where is about this computer, so that stays. Run under the state
     * lock.
     */
    readonly signOut: Effect.Effect<void, PeerHubError>;
    /** Forgets a session the Hub refused, so the app asks to sign in again. */
    readonly dropSession: Effect.Effect<void, PeerHubError>;
  }
>()("t3/peerHub/core/hub/PeerHubClient") {}

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const api = yield* HubApi.make;
  const features = yield* SubscriptionRef.make(LEGACY_HUB_FEATURES);
  const info = yield* Ref.make<PeerHubInfo | undefined>(undefined);

  const hubUrl = (persisted: PersistedState) => persisted.hubUrl ?? DEFAULT_HUB_URL;

  const storedSession = secrets.get(SESSION_SECRET).pipe(
    Effect.map(Option.map((bytes) => Buffer.from(bytes).toString("utf8"))),
    Effect.orElseSucceed(() => Option.none<string>()),
  );

  const session: PeerHubClient["Service"]["session"] = Effect.gen(function* () {
    const { persisted } = yield* state.read;
    const stored = yield* storedSession;
    if (persisted.email === null || Option.isNone(stored)) {
      return yield* new PeerHubError({ detail: HubApi.SIGN_IN_FIRST, refused: true });
    }
    return { hubUrl: hubUrl(persisted), session: stored.value };
  });

  const request: PeerHubClient["Service"]["request"] = (schema, { workspace, path, ...input }) =>
    Effect.flatMap(session, ({ hubUrl, session }) =>
      api.request(schema, {
        ...input,
        hubUrl,
        session,
        path: `/v1/workspaces/${encodeURIComponent(workspace)}${path}`,
      }),
    );

  const stream: PeerHubClient["Service"]["stream"] = ({ workspace, path, texts }) =>
    Stream.unwrap(
      Effect.map(session, ({ hubUrl, session }) =>
        api.eventStream(
          hubUrl,
          session,
          `/v1/workspaces/${encodeURIComponent(workspace)}${path}`,
          texts,
        ),
      ),
    );

  const me: PeerHubClient["Service"]["me"] = Effect.gen(function* () {
    const signedIn = yield* session;
    const answer = yield* api.me(signedIn.hubUrl, signedIn.session);
    const served = featuresOf(answer);
    if (!sameFeatures(yield* SubscriptionRef.get(features), served)) {
      yield* SubscriptionRef.set(features, served);
    }
    yield* Ref.set(info, hubInfoOf(answer));
    return answer;
  });

  const startSignIn: PeerHubClient["Service"]["startSignIn"] = (input) =>
    Effect.gen(function* () {
      const { persisted } = yield* state.read;
      if (persisted.email !== null && Option.isSome(yield* storedSession)) {
        return yield* hubError(`You are signed in as ${persisted.email}. Sign out first.`);
      }
      const url = normalizeHubUrl(input.hubUrl ?? hubUrl(persisted));
      if (url === null) {
        return yield* hubError("Enter the hub's address, e.g. https://hub.example.com.");
      }
      const started = yield* api.startSignIn(url, input.email);
      const sentAt = DateTime.formatIso(yield* DateTime.now);
      yield* state.updatePersisted((p) => ({
        ...p,
        hubUrl: url === DEFAULT_HUB_URL ? null : url,
        pendingSignIn: {
          email: started.email,
          sentAt,
          ...(started.code === undefined ? {} : { echoedCode: started.code }),
        },
      }));
    });

  const finishSignIn: PeerHubClient["Service"]["finishSignIn"] = (input) =>
    Effect.gen(function* () {
      const { persisted } = yield* state.read;
      const pending = persisted.pendingSignIn;
      if (pending === null) return yield* hubError("Ask for a sign-in code first.");
      const signedIn = yield* api.finishSignIn(
        hubUrl(persisted),
        pending.email,
        input.code.replace(/\s+/g, ""),
      );
      yield* secrets
        .set(SESSION_SECRET, Buffer.from(signedIn.session, "utf8"))
        .pipe(Effect.mapError(() => hubError("Could not store the hub session.")));
      yield* state.updatePersisted((p) => ({ ...p, email: signedIn.email, pendingSignIn: null }));
      return { email: signedIn.email, session: signedIn.session };
    });

  const signOut: PeerHubClient["Service"]["signOut"] = Effect.gen(function* () {
    const { persisted } = yield* state.read;
    const stored = yield* storedSession;
    if (Option.isSome(stored)) {
      yield* api.signOut(hubUrl(persisted), stored.value).pipe(Effect.ignoreCause({ log: true }));
    }
    yield* secrets.remove(SESSION_SECRET).pipe(Effect.ignoreCause({ log: true }));
    yield* Ref.set(info, undefined);
    // Keep the hub address so signing back in is one step, and what each person left so it is
    // not rejoined. Checkouts stay: they are the person's files.
    yield* state.updatePersisted(() => ({
      ...EMPTY_PERSISTED,
      hubUrl: persisted.hubUrl,
      ...(persisted.leftWorkspaces === undefined
        ? {}
        : { leftWorkspaces: persisted.leftWorkspaces }),
      // Which checkouts and threads belong where is about this computer's files.
      ...(persisted.localCheckouts === undefined
        ? {}
        : { localCheckouts: persisted.localCheckouts }),
      ...(persisted.assignments === undefined ? {} : { assignments: persisted.assignments }),
      ...(persisted.coordination === undefined ? {} : { coordination: persisted.coordination }),
      // Which plugins run here is the environment owner's choice, not the signed-in person's.
      ...(persisted.plugins === undefined ? {} : { plugins: persisted.plugins }),
      ...(persisted.pluginData === undefined ? {} : { pluginData: persisted.pluginData }),
    }));
  });

  const dropSession: PeerHubClient["Service"]["dropSession"] = Effect.gen(function* () {
    yield* secrets.remove(SESSION_SECRET).pipe(Effect.ignoreCause({ log: true }));
    yield* Ref.set(info, undefined);
    yield* state.updatePersisted((p) => ({
      ...p,
      email: null,
      workspaces: [],
      joinable: [],
      domainOffers: [],
      removedFrom: [],
    }));
  });

  return PeerHubClient.of({
    api,
    hubUrl,
    storedSession,
    session,
    request,
    stream,
    features: SubscriptionRef.get(features),
    featureChanges: SubscriptionRef.changes(features),
    hubInfo: Ref.get(info),
    me,
    startSignIn,
    finishSignIn,
    signOut,
    dropSession,
  });
});

export const layer = Layer.effect(PeerHubClient, make);
