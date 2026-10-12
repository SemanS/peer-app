/**
 * What Knowledge to keep says when its list did not load, or was never asked for: which of the
 * Hub's failures it was (the server names it: `PeerHubError.kind`), what Peer knows of the Hub
 * meanwhile, and what the person can do. The page shows one card for it and never an empty list:
 * an empty list is what a Hub answered when nothing waits.
 */
import { isPeerHubFailureKind, type PeerHubFailureKind } from "@t3tools/contracts";

/** The Hub's failures, as the server tells them apart, and the ones it cannot: `failed`. */
export type KnowledgeFailureKind = PeerHubFailureKind | "failed";

/** A failed request as the page reads it, from whatever the request failed with. */
export interface KnowledgeFailure {
  readonly kind: KnowledgeFailureKind;
  readonly message: string;
  /** The HTTP status the Hub answered with. */
  readonly status?: number;
  /** The Hub's own error code. */
  readonly code?: string;
  readonly hubUrl?: string;
  /** What was asked of the Hub, e.g. `GET /v1/workspaces/acme/candidates/pay`. */
  readonly request?: string;
  /** How long it waited, in milliseconds, when no answer came. */
  readonly waitedMs?: number;
}

/** The list was never asked for: the primary environment is not connected. */
export interface KnowledgeNotAsked {
  readonly kind: "disconnected";
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

/**
 * What a request failed with, as a failure of the page. Only a `PeerHubError` from a server that
 * names where the call stopped has a kind; an older server's error, another error and a string
 * are `failed`, with their message as it is.
 */
function failureOf(error: unknown): KnowledgeFailure {
  const fields = isRecord(error) ? error : {};
  const text = (key: string) => {
    const value = fields[key];
    return typeof value === "string" && value.trim() !== "" ? value : undefined;
  };
  const count = (key: string) => {
    const value = fields[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  const message =
    typeof error === "string" && error.trim() !== ""
      ? error
      : (text("message") ?? "The environment request failed.");
  // The fields below are the Hub error's own: another error with a `status` is not the Hub's.
  if (fields["_tag"] !== "PeerHubError") return { kind: "failed", message };
  const kind = fields["kind"];
  const status = count("status");
  const code = text("code");
  const hubUrl = text("hubUrl");
  const request = text("request");
  const waitedMs = count("waitedMs");
  return {
    kind: isPeerHubFailureKind(kind) ? kind : "failed",
    message,
    ...(status === undefined ? {} : { status }),
    ...(code === undefined ? {} : { code }),
    ...(hubUrl === undefined ? {} : { hubUrl }),
    ...(request === undefined ? {} : { request }),
    ...(waitedMs === undefined ? {} : { waitedMs }),
  };
}

/** The errors of an environment that could not be asked at all: it is offline, blocked or unknown. */
const NOT_ASKED_ERRORS: ReadonlySet<string> = new Set([
  "EnvironmentRpcUnavailableError",
  "EnvironmentNotRegisteredError",
  "ConnectionTransientError",
  "ConnectionBlockedError",
]);

/**
 * What a list request failed with: nothing was asked when the environment itself could not be
 * reached, else a failure of the Hub or of the request.
 */
export function readKnowledgeProblem(error: unknown): KnowledgeFailure | KnowledgeNotAsked {
  const tag = isRecord(error) ? error["_tag"] : undefined;
  return typeof tag === "string" && NOT_ASKED_ERRORS.has(tag)
    ? { kind: "disconnected" }
    : failureOf(error);
}

/** Peer syncs with the Hub every ten minutes: a sync older than this says nothing of it now. */
const HUB_SYNC_FRESH_MS = 15 * 60_000;

/** "just now", "1 min ago", "3 hours ago", "2 days ago". */
export function agoLabel(thenMs: number, nowMs: number): string {
  const minutes = Math.floor(Math.max(0, nowMs - thenMs) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

const wholeSeconds = (ms: number) => Math.max(1, Math.round(ms / 1000));
const secondsLabel = (ms: number) => {
  const seconds = wholeSeconds(ms);
  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
};

/**
 * The Hub's address as a sentence names it: without the scheme, a closing slash, and any sign-in
 * written into the address, which a person copies into a report.
 */
const hubHost = (url: string | undefined): string | null => {
  const host =
    url
      ?.trim()
      .replace(/^https?:\/\//i, "")
      .replace(/^[^/@]*@/, "")
      .replace(/\/+$/, "") ?? "";
  return host === "" ? null : host;
};

/** What the app already holds that bears on the failure. */
export interface KnowledgeErrorFacts {
  /** The primary environment, whose Peer asks the Hub; null before the app knows one. */
  readonly environment: {
    readonly label: string;
    /** It is on its way to connected: asking it to reconnect would only interrupt that. */
    readonly connecting: boolean;
  } | null;
  /** The Peer status of that environment: the Hub it asks and when it last heard from it. */
  readonly hub: {
    readonly url: string;
    readonly version: string | null;
    readonly commit: string | null;
    /** The last time Peer synced with the Hub. */
    readonly syncedAt: string | null;
    /** What the last sync failed with; null when it did not fail. */
    readonly syncError: string | null;
    readonly signedIn: boolean;
  } | null;
  readonly appVersion: string;
  /** When this list last loaded, in this session (milliseconds). */
  readonly lastLoadedAt: number | null;
  /** A list from before the failure is still shown under the card. */
  readonly showingOlder: boolean;
  /** The page's clock (milliseconds), which ticks by the minute: what "ago" counts from. */
  readonly now: number;
}

/**
 * How long ago Peer synced with the Hub, when that is a reason to say the Hub is up: a moment ago,
 * and the sync did not fail since. Anything less says nothing, since a Hub that was up 20 minutes
 * ago may not be now.
 */
function recentSync(facts: KnowledgeErrorFacts): string | null {
  const hub = facts.hub;
  if (hub === null || !hub.signedIn || hub.syncError !== null || hub.syncedAt === null) return null;
  const at = Date.parse(hub.syncedAt);
  return Number.isFinite(at) && facts.now - at <= HUB_SYNC_FRESH_MS
    ? agoLabel(at, facts.now)
    : null;
}

/** A sentence's pieces: plain text, and the names (an environment, a Hub) the page makes bold. */
export type KnowledgeErrorSegment = string | { readonly strong: string };

/** A sentence as plain text. */
export const plainText = (line: ReadonlyArray<KnowledgeErrorSegment>): string =>
  line.map((segment) => (typeof segment === "string" ? segment : segment.strong)).join("");

/**
 * A sentence's pieces, each with where in the sentence it starts: a key that stays with its piece
 * whatever the sentence around it says.
 */
export function lineParts(
  line: ReadonlyArray<KnowledgeErrorSegment>,
): ReadonlyArray<{ readonly at: number; readonly text: string; readonly strong: boolean }> {
  let at = 0;
  return line.map((segment) => {
    const part =
      typeof segment === "string"
        ? { at, text: segment, strong: false }
        : { at, text: segment.strong, strong: true };
    at += part.text.length;
    return part;
  });
}

export type KnowledgeErrorAction = "retry" | "copy" | "hub" | "signIn" | "reconnect";

export interface KnowledgeErrorView {
  readonly kind: KnowledgeFailureKind | KnowledgeNotAsked["kind"];
  readonly tone: "error" | "warning" | "neutral";
  readonly title: string;
  readonly lines: ReadonlyArray<ReadonlyArray<KnowledgeErrorSegment>>;
  readonly actions: ReadonlyArray<KnowledgeErrorAction>;
  /** What was asked, where, what came back: for a person who reports it. Empty where nothing helps. */
  readonly details: ReadonlyArray<{
    readonly label: string;
    readonly value: string;
    /** A request, which the page sets in code type. */
    readonly code?: true;
  }>;
  /** The text "Copy details" puts on the clipboard; empty where that is not offered. */
  readonly copy: string;
}

const environmentSegments = (facts: KnowledgeErrorFacts): ReadonlyArray<KnowledgeErrorSegment> =>
  facts.environment === null ? ["Peer"] : ["Peer on ", { strong: facts.environment.label }];

const hubSegments = (
  host: string | null,
  capital: boolean,
): ReadonlyArray<KnowledgeErrorSegment> =>
  host === null ? [capital ? "The Hub" : "the Hub"] : [{ strong: host }];

const LOAD_FAILED = "Couldn’t load what to keep";

const TITLES: Readonly<Record<KnowledgeFailureKind, string>> = {
  unreachable: LOAD_FAILED,
  refused: LOAD_FAILED,
  invalid: LOAD_FAILED,
  failed: LOAD_FAILED,
  unsupported: "This Hub can’t do it yet",
  signedOut: "You’re signed out of the Hub",
};

/** The sentences under the title. */
function sentences(
  failure: KnowledgeFailure,
  facts: KnowledgeErrorFacts,
  host: string | null,
): Array<ReadonlyArray<KnowledgeErrorSegment>> {
  switch (failure.kind) {
    case "unreachable": {
      const who = environmentSegments(facts);
      const syncedAgo = recentSync(facts);
      return [
        failure.waitedMs === undefined
          ? [...who, " couldn’t reach ", ...hubSegments(host, false), "."]
          : [
              ...who,
              " asked ",
              ...hubSegments(host, false),
              ` and got no answer within ${secondsLabel(failure.waitedMs)}.`,
            ],
        syncedAgo === null
          ? ["Check the network or VPN."]
          : [
              `The Hub itself is up: Peer synced with it ${syncedAgo}. Only this request failed, so your other work is fine.`,
            ],
      ];
    }
    case "refused":
      return [
        [
          ...hubSegments(host, true),
          ` refused with HTTP ${failure.status ?? "an error"}${
            // Only the Hub's own words are worth quoting; what fronts it says nothing of the cause.
            failure.code === undefined ? "" : `: “${failure.message}”`
          }. Tell an admin if it stays.`,
        ],
      ];
    case "invalid":
      return [
        [
          ...hubSegments(host, true),
          " answered, but Peer couldn’t read the answer. It may be a different version than this Peer expects. Tell an admin if it stays.",
        ],
      ];
    case "unsupported": {
      const version = facts.hub?.version ?? null;
      const status = failure.status === undefined ? "" : ` (${failure.status})`;
      return [
        [
          `${version === null ? (host ?? "This Hub") : `Hub ${version}`} has no knowledge to keep${status}. An admin can update the Hub.`,
        ],
      ];
    }
    case "signedOut":
      return [["Your Hub session ended. Sign in again to load knowledge."]];
    case "failed":
      return [[...environmentSegments(facts), " couldn’t load this list: ", failure.message]];
  }
}

/** What happened, in a few words, for the details. */
function whatHappened(failure: KnowledgeFailure): string {
  const status = failure.status === undefined ? "" : ` (HTTP ${failure.status})`;
  switch (failure.kind) {
    case "unreachable":
      return failure.waitedMs === undefined
        ? "Could not connect (network error)"
        : `No answer in ${wholeSeconds(failure.waitedMs)} s (timeout)`;
    case "refused":
      return `The Hub answered with an error${status}`;
    case "invalid":
      return `The Hub’s answer could not be read${status}`;
    case "unsupported":
      return `The Hub has no such route${status}`;
    case "signedOut":
      return `The Hub ended the session${status}`;
    case "failed":
      return failure.message;
  }
}

const isoOf = (ms: number | null) =>
  ms !== null && Number.isFinite(ms) ? new Date(ms).toISOString() : null;

/** The card for a list that was never asked for. */
function notAsked(facts: KnowledgeErrorFacts): KnowledgeErrorView {
  const environment = facts.environment;
  return {
    kind: "disconnected",
    tone: "neutral",
    title: "Nothing was asked",
    lines: [
      [
        ...environmentSegments(facts),
        " isn’t connected right now, so this list wasn’t loaded. It isn’t empty.",
      ],
    ],
    // Reconnecting what is already on its way would only interrupt it.
    actions: environment === null || environment.connecting ? [] : ["reconnect"],
    details: [],
    copy: "",
  };
}

/**
 * The card for a list that did not load, or was not asked for: what failed and where, the
 * remedies that fit it (Try again and Copy details when asking again can help; the Hub's page, the
 * sign-in, a reconnect when only that can), and for a person who reports it, the details. `facts`
 * say what else the app knows; the Hub is said to be up only on its evidence.
 */
export function knowledgeErrorView(
  problem: KnowledgeFailure | KnowledgeNotAsked,
  facts: KnowledgeErrorFacts,
): KnowledgeErrorView {
  if (problem.kind === "disconnected") return notAsked(facts);
  const failure = problem;
  const host = hubHost(failure.hubUrl ?? facts.hub?.url);
  const lines = sentences(failure, facts, host);
  const base = { kind: failure.kind, title: TITLES[failure.kind] } as const;
  if (failure.kind === "unsupported") {
    return { ...base, tone: "warning", lines, actions: ["hub"], details: [], copy: "" };
  }
  if (failure.kind === "signedOut") {
    return { ...base, tone: "warning", lines, actions: ["signIn"], details: [], copy: "" };
  }

  if (facts.showingOlder && facts.lastLoadedAt !== null) {
    lines.push([
      `What is listed below loaded ${agoLabel(facts.lastLoadedAt, facts.now)} and may be out of date.`,
    ]);
  }
  const where = facts.environment === null ? "Peer" : `Peer on ${facts.environment.label}`;
  const hub = facts.hub;
  const hubVersions =
    hub === null || (hub.version === null && hub.commit === null)
      ? ""
      : ` · Hub${hub.version === null ? "" : ` ${hub.version}`}${hub.commit === null ? "" : ` (${hub.commit})`}`;
  const syncedMs = hub === null || hub.syncedAt === null ? Number.NaN : Date.parse(hub.syncedAt);
  const details: Array<{ label: string; value: string; code?: true }> = [
    ...(failure.request === undefined
      ? []
      : [{ label: "Request", value: failure.request, code: true as const }]),
    { label: "Route", value: host === null ? where : `${where} → ${host}` },
    { label: "What happened", value: whatHappened(failure) },
    ...(facts.lastLoadedAt === null
      ? []
      : [{ label: "Last success", value: agoLabel(facts.lastLoadedAt, facts.now) }]),
    ...(Number.isFinite(syncedMs)
      ? [{ label: "Last Hub sync", value: agoLabel(syncedMs, facts.now) }]
      : []),
    { label: "Versions", value: `Peer ${facts.appVersion}${hubVersions}` },
  ];
  // The copy says when, not only how long ago: it is read later, by someone else.
  const exactly = new Map([
    ["Last success", isoOf(facts.lastLoadedAt)],
    ["Last Hub sync", isoOf(syncedMs)],
  ]);
  const copy = [
    "Knowledge to keep couldn’t load",
    ...details.map(({ label, value }) => {
      const at = exactly.get(label);
      return `${label}: ${value}${at === null || at === undefined ? "" : ` (${at})`}`;
    }),
    ...(failure.status === undefined ? [] : [`Status: ${failure.status}`]),
    ...(failure.code === undefined ? [] : [`Code: ${failure.code}`]),
    `As of: ${isoOf(facts.now)}`,
  ].join("\n");
  return { ...base, tone: "error", lines, actions: ["retry", "copy"], details, copy };
}

/**
 * What the page shows besides the card: the candidates, a note that the list is on its way, or
 * that nothing waits. "Nothing waits" is only ever what the Hub answered: a list that was not asked
 * for, or failed, has its card to say so and nothing in its place.
 */
export function knowledgeBody(input: {
  /** The primary environment is connected, so the list was asked for. */
  readonly asked: boolean;
  /** A list has arrived, now or before a later failure. */
  readonly loaded: boolean;
  readonly failed: boolean;
  /** Candidates to show: those waiting, and those kept while the page is open. */
  readonly cards: number;
}): "cards" | "loading" | "empty" | "none" {
  if (input.cards > 0) return "cards";
  if (!input.asked || input.failed) return "none";
  return input.loaded ? "empty" : "loading";
}
