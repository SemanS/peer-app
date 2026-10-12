/**
 * What the webhook dialog edits and sends, apart from how it draws (design artboard 21): the form's
 * draft, how it reads a saved webhook and writes one back into the settings document's
 * `webhooks.<id>`, the secrets it stores (the destination URL and the signing key, which the
 * document only names), and what keeps Save off. The Hub's own check (`webhooks::config`) decides
 * again on every save; these only keep the form from offering what it would refuse.
 *
 * A webhook in the document is `{ format, url, events, projects?, signingSecret?, enabled }`, where
 * `url` and each `signingSecret` are `${secret:NAME}` references to sealed workspace secrets. Fields
 * a newer Hub adds are kept as they are.
 */
import { getAt } from "@t3tools/client-runtime/peer-settings";
import { eventLabel } from "@t3tools/client-runtime/peer/webhooks";

import type { ReviewOperation } from "./reviewChanges.logic";
import type { SettingsDocument } from "./settingsView.logic";

/** A workspace has at most this many webhooks, and a webhook this many events. */
export const MAX_WEBHOOKS = 20;
export const MAX_EVENTS = 10;
/** The longest id the Hub takes. */
const ID_MAX = 48;

// ---- formats and events --------------------------------------------------------------------------

export type WebhookFormat = "slack" | "teams" | "generic";

export const FORMATS: ReadonlyArray<{ readonly id: WebhookFormat; readonly label: string }> = [
  { id: "slack", label: "Slack" },
  { id: "teams", label: "Teams" },
  { id: "generic", label: "Generic" },
];

export const isFormat = (value: string): value is WebhookFormat =>
  FORMATS.some((format) => format.id === value);

/** A format as the lists name it; one only a newer Hub has stays as it is. */
export const formatLabel = (format: string): string =>
  FORMATS.find((entry) => entry.id === format)?.label ?? format;

/**
 * The events the dialog offers, each as the Hub's event names it stands for. A team request is both
 * its sending and its answer.
 */
export const EVENT_GROUPS: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly events: ReadonlyArray<string>;
}> = [
  { key: "done", label: "Task finished", events: ["task.done"] },
  { key: "review", label: "Needs review", events: ["task.review"] },
  { key: "overlap", label: "Overlap", events: ["overlap.ask"] },
  { key: "request", label: "Team request", events: ["request.created", "request.answered"] },
  { key: "announce", label: "Announcement", events: ["announcement.posted"] },
];

type EventGroup = (typeof EVENT_GROUPS)[number];

const GROUPED = new Set(EVENT_GROUPS.flatMap((group) => group.events));

/** Whether the webhook gets the group's events (any of its names). */
export const groupOn = (events: ReadonlyArray<string>, group: EventGroup): boolean =>
  group.events.some((event) => events.includes(event));

/** The events with the group's names added or taken away, the others as they were. */
export function withGroup(
  events: ReadonlyArray<string>,
  group: EventGroup,
  on: boolean,
): ReadonlyArray<string> {
  if (!on) return events.filter((event) => !group.events.includes(event));
  return [...events, ...group.events.filter((event) => !events.includes(event))];
}

/** The events the dialog has no checkbox for (merged work, hand-offs, waiting knowledge), which a webhook may have. */
export const otherEvents = (events: ReadonlyArray<string>): ReadonlyArray<string> =>
  events.filter((event) => !GROUPED.has(event));

export const withoutEvent = (events: ReadonlyArray<string>, event: string): ReadonlyArray<string> =>
  events.filter((candidate) => candidate !== event);

export const otherEventLabel = eventLabel;

// ---- secrets and ids ----------------------------------------------------------------------------

const SECRET_REFERENCE = /^\$\{secret:([A-Za-z0-9_-]{1,64})\}$/;

/** `${secret:NAME}`: how the document names a secret. */
export const secretRef = (name: string): string => `\${secret:${name}}`;

/** The name in a `${secret:NAME}`; null for anything else. */
export const secretNameOf = (reference: unknown): string | null =>
  typeof reference === "string" ? (SECRET_REFERENCE.exec(reference)?.[1] ?? null) : null;

/**
 * The id a name makes: lowercase letters and digits joined by single hyphens, at most 48
 * characters, accents set aside. A name with no letter or digit from the Latin alphabet makes none.
 */
export function idFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ID_MAX)
    .replace(/-+$/g, "");
}

/** How a list names a webhook: its id as words, `teams-alerts` as "Teams alerts". */
export function titleOfId(id: string): string {
  const words = id.split("-").join(" ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** The title a review of the webhook goes by. */
export const reviewScope = (id: string): string => `Webhook “${titleOfId(id)}”`;

/** The name a webhook's own secret gets: `ops` stores `OPS_WEBHOOK_URL` and `OPS_SIGNING_KEY`. */
export function secretNameFor(id: string, kind: "WEBHOOK_URL" | "SIGNING_KEY"): string {
  return `${id.toUpperCase().replace(/-/g, "_")}_${kind}`;
}

// ---- reading a saved webhook ----------------------------------------------------------------------

/** A webhook as the document has it. */
export interface SavedHook {
  readonly format: string;
  readonly url: string;
  readonly events: ReadonlyArray<string>;
  /** Only these projects; null for the projects open to everyone. */
  readonly projects: ReadonlyArray<string> | null;
  readonly signingSecret: ReadonlyArray<string>;
  readonly enabled: boolean;
  /** What a newer Hub adds, kept as it is. */
  readonly extra: Readonly<Record<string, unknown>>;
}

const KNOWN = new Set(["format", "url", "events", "projects", "signingSecret", "enabled"]);

const isMapping = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** One entry of the document's `webhooks` as a saved webhook; null where it is not one. */
export function readHook(raw: unknown): SavedHook | null {
  if (!isMapping(raw)) return null;
  const signing = raw.signingSecret;
  return {
    format: typeof raw.format === "string" ? raw.format : "",
    url: typeof raw.url === "string" ? raw.url : "",
    events: textsOf(raw.events),
    projects: Array.isArray(raw.projects) ? textsOf(raw.projects) : null,
    signingSecret: typeof signing === "string" ? [signing] : textsOf(signing),
    enabled: raw.enabled !== false,
    extra: Object.fromEntries(Object.entries(raw).filter(([key]) => !KNOWN.has(key))),
  };
}

/** The webhooks of the document by id, in the order it has them. */
export function savedHooks(document: SettingsDocument | null): ReadonlyMap<string, SavedHook> {
  const hooks = document === null ? undefined : getAt(document, ["webhooks"]);
  const entries = isMapping(hooks) ? Object.entries(hooks) : [];
  return new Map(
    entries.flatMap(([id, raw]) => {
      const hook = readHook(raw);
      return hook === null ? [] : [[id, hook] as const];
    }),
  );
}

// ---- the draft ----------------------------------------------------------------------------------

export interface WebhookDraft {
  /** The id of a webhook that exists; null while it is new and its name makes the id. */
  readonly existingId: string | null;
  readonly name: string;
  /** One of `FORMATS`, or what a newer Hub saved. */
  readonly format: string;
  /** The secret the saved destination names; null where there is none to keep. */
  readonly urlSecret: string | null;
  /** A destination typed in; null while the saved one stands. */
  readonly newUrl: string | null;
  readonly events: ReadonlyArray<string>;
  /** Only these projects; null for the projects open to everyone. */
  readonly projects: ReadonlyArray<string> | null;
  /** The secrets the saved webhook signs with (one, or two while a key is rotated). */
  readonly signingSecrets: ReadonlyArray<string>;
  /** A signing key typed or generated; null while the saved one stands. */
  readonly newSigningKey: string | null;
  readonly enabled: boolean;
  readonly extra: Readonly<Record<string, unknown>>;
}

/** What Add webhook starts from: Slack, the two events most want, every project open to all. */
export function newDraft(): WebhookDraft {
  return {
    existingId: null,
    name: "",
    format: "slack",
    urlSecret: null,
    newUrl: "",
    events: ["task.done", "task.review"],
    projects: null,
    signingSecrets: [],
    newSigningKey: null,
    enabled: true,
    extra: {},
  };
}

/** What Edit starts from: the saved webhook as it is. */
export function draftOf(id: string, hook: SavedHook): WebhookDraft {
  const urlSecret = secretNameOf(hook.url);
  return {
    existingId: id,
    name: titleOfId(id),
    format: hook.format,
    urlSecret,
    newUrl: urlSecret === null ? "" : null,
    events: hook.events,
    projects: hook.projects,
    signingSecrets: hook.signingSecret.flatMap((reference) => {
      const name = secretNameOf(reference);
      return name === null ? [] : [name];
    }),
    newSigningKey: null,
    enabled: hook.enabled,
    extra: hook.extra,
  };
}

/** The id the webhook has or will have. */
export const idOf = (draft: WebhookDraft): string => draft.existingId ?? idFromName(draft.name);

/** The secret the destination is, or will be, stored under. */
export const urlSecretOf = (draft: WebhookDraft): string =>
  draft.urlSecret ?? secretNameFor(idOf(draft), "WEBHOOK_URL");

/** The names the webhook signs with: what it has, else (for a generic one, or one given a key) its own. */
function signingNames(draft: WebhookDraft): ReadonlyArray<string> {
  if (draft.signingSecrets.length > 0) return draft.signingSecrets;
  const typed = draft.newSigningKey !== null && draft.newSigningKey.trim() !== "";
  return draft.format === "generic" || typed ? [secretNameFor(idOf(draft), "SIGNING_KEY")] : [];
}

/** The webhook as `webhooks.<id>` of the document holds it. */
export function hookOf(draft: WebhookDraft): Record<string, unknown> {
  const signing = signingNames(draft);
  return {
    ...draft.extra,
    format: draft.format,
    url: secretRef(urlSecretOf(draft)),
    events: [...draft.events],
    ...(draft.projects === null ? {} : { projects: [...draft.projects] }),
    ...(signing.length === 0 ? {} : { signingSecret: signing.map(secretRef) }),
    enabled: draft.enabled,
  };
}

/** The secrets to store before the change is reviewed: what was typed or generated, under its name. */
export function secretsToStore(
  draft: WebhookDraft,
): ReadonlyArray<{ readonly name: string; readonly value: string }> {
  const url = draft.newUrl?.trim() ?? "";
  const key = draft.newSigningKey?.trim() ?? "";
  return [
    ...(url === "" ? [] : [{ name: urlSecretOf(draft), value: url }]),
    ...(key === ""
      ? []
      : [
          { name: signingNames(draft)[0] ?? secretNameFor(idOf(draft), "SIGNING_KEY"), value: key },
        ]),
  ];
}

/**
 * The draft once what was typed is stored: the destination and the key are then the saved ones, so
 * a second Save (after the review was left to edit again) does not store them again.
 */
export function afterStoring(draft: WebhookDraft): WebhookDraft {
  const url = draft.newUrl?.trim() ?? "";
  const key = draft.newSigningKey?.trim() ?? "";
  return {
    ...draft,
    ...(url === "" ? {} : { urlSecret: urlSecretOf(draft), newUrl: null }),
    ...(key === "" ? {} : { signingSecrets: [...signingNames(draft)], newSigningKey: null }),
  };
}

// ---- what is wrong ------------------------------------------------------------------------------

/** Why an address cannot be a destination; null for none typed, or one that can. */
export function urlProblem(value: string): string | null {
  const text = value.trim();
  if (text === "") return null;
  if (/\s/.test(text)) return "An address has no spaces.";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") return "Use an https address: http is not accepted.";
    return url.hostname === "" ? "That is not a web address." : null;
  } catch {
    return "That is not a web address.";
  }
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Why a signing key is not one the Hub takes: `whsec_` and standard base64 of 24 to 64 bytes, as
 * the Standard Webhooks libraries read it. Null for none typed, or one that is.
 */
export function signingKeyProblem(value: string): string | null {
  const text = value.trim();
  if (text === "") return null;
  if (!text.startsWith("whsec_")) return "A signing key starts with whsec_. Generate one.";
  const body = text.slice("whsec_".length);
  if (!BASE64.test(body) || body.length % 4 !== 0) {
    return "After whsec_ comes base64. Generate a key, or paste the receiver’s.";
  }
  const bytes = atob(body).length;
  return bytes >= 24 && bytes <= 64 ? null : "A signing key holds 24 to 64 bytes. Generate one.";
}

/** A new signing key: `whsec_` and the base64 of 32 random bytes. */
export function generateSigningKey(
  random: (length: number) => Uint8Array = (length) =>
    crypto.getRandomValues(new Uint8Array(length)),
): string {
  const bytes = random(32);
  return `whsec_${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))}`;
}

export interface WebhookProblems {
  readonly name: string | null;
  readonly url: string | null;
  readonly events: string | null;
  readonly projects: string | null;
  readonly signing: string | null;
  readonly limit: string | null;
  /** Nothing is wrong and nothing is missing: Save is on. */
  readonly ready: boolean;
}

/**
 * What is wrong with the draft, field by field, and whether it can be saved. What is only missing (a
 * name, an address, a key not typed yet) keeps Save off without a complaint. A saved webhook whose
 * secret is not stored can be saved as it is: it stays off, as the list says, until a value is set.
 */
export function checkDraft(
  draft: WebhookDraft,
  context: { readonly takenIds: ReadonlySet<string> },
): WebhookProblems {
  const id = idOf(draft);
  const isNew = draft.existingId === null;
  const name = isNew
    ? draft.name.trim() === ""
      ? { problem: null, missing: true }
      : id === ""
        ? {
            problem: "The id is made from the letters a–z and the digits in the name. Add some.",
            missing: false,
          }
        : context.takenIds.has(id)
          ? {
              problem: `A webhook called “${id}” exists already. Pick another name.`,
              missing: false,
            }
          : { problem: null, missing: false }
    : { problem: null, missing: false };
  const limit =
    isNew && context.takenIds.size >= MAX_WEBHOOKS
      ? { problem: `A workspace has up to ${MAX_WEBHOOKS} webhooks.`, missing: false }
      : { problem: null, missing: false };
  const typedUrl = draft.newUrl?.trim() ?? "";
  const url = {
    problem: urlProblem(typedUrl),
    missing: typedUrl === "" && draft.urlSecret === null,
  };
  const events = {
    problem:
      draft.events.length === 0
        ? "Pick at least one event."
        : draft.events.length > MAX_EVENTS
          ? `A webhook takes up to ${MAX_EVENTS} events.`
          : null,
    missing: false,
  };
  const projects = {
    problem:
      draft.projects !== null && draft.projects.length === 0
        ? "Pick at least one project, or open it to all."
        : null,
    missing: false,
  };
  const typedKey = draft.newSigningKey?.trim() ?? "";
  const signing = {
    problem: signingKeyProblem(typedKey),
    missing: draft.format === "generic" && draft.signingSecrets.length === 0 && typedKey === "",
  };
  const format = isFormat(draft.format)
    ? { problem: null, missing: false }
    : { problem: "Pick a format.", missing: false };
  const parts = [name, limit, url, events, projects, signing, format];
  return {
    name: name.problem,
    url: url.problem,
    events: events.problem,
    projects: projects.problem,
    signing: signing.problem,
    limit: limit.problem,
    ready: parts.every((part) => part.problem === null && !part.missing),
  };
}

// ---- the change -----------------------------------------------------------------------------------

/**
 * The change that saves the webhook (a hook), or deletes it (null), as a review of the document's
 * `webhooks.<id>` against the revision the page read.
 */
export function saveOperation(input: {
  readonly workspace: string;
  readonly base: number;
  readonly id: string;
  readonly hook: Record<string, unknown> | null;
}): ReviewOperation {
  return {
    kind: "save",
    workspace: input.workspace,
    base: input.base,
    set: [{ path: ["webhooks", input.id], value: input.hook }],
  };
}

/** The projects a webhook can be limited to, from the document, by name. */
export function projectChoices(
  document: SettingsDocument | null,
  fallback: ReadonlyArray<{ readonly id: string; readonly name: string }>,
): ReadonlyArray<{ readonly id: string; readonly name: string }> {
  const projects = document === null ? undefined : getAt(document, ["projects"]);
  if (isMapping(projects)) {
    return Object.entries(projects)
      .map(([id, project]) => {
        const name = getAt(project, ["name"]);
        return { id, name: typeof name === "string" && name !== "" ? name : id };
      })
      .toSorted((a, b) => a.name.localeCompare(b.name));
  }
  return [...fallback].toSorted((a, b) => a.name.localeCompare(b.name));
}

// ---- what each format needs said --------------------------------------------------------------------

/**
 * What the form tells about a format: example values for the name and the address, and where to get
 * the address. Slack and Teams hand the address out themselves; a generic one is the person's own.
 */
export interface FormatCopy {
  readonly namePlaceholder: string;
  readonly urlPlaceholder: string;
  /** Where the address comes from; null for a format only a newer Hub has, which this app cannot tell about. */
  readonly urlHelp: string | null;
}

const FORMAT_COPY: Readonly<Record<WebhookFormat, FormatCopy>> = {
  slack: {
    namePlaceholder: "Team Slack",
    urlPlaceholder: "https://hooks.slack.com/services/T0000/B0000/XXXXXXXX",
    urlHelp:
      "In Slack: Apps › Incoming Webhooks › Add to Slack, pick the channel, copy the Webhook URL.",
  },
  teams: {
    namePlaceholder: "Ops in Teams",
    urlPlaceholder: "https://prod-00.westeurope.logic.azure.com/workflows/…",
    urlHelp:
      "In Teams: the channel’s ⋯ › Workflows › “Post to a channel when a webhook request is received”, then copy the URL it shows.",
  },
  generic: {
    namePlaceholder: "Our dashboard",
    urlPlaceholder: "https://example.com/peer/events",
    // What the Hub's worker does with the answer: 2xx is delivered; a timeout, 429 and 5xx are tried
    // again; any other status (a redirect included) fails the delivery.
    urlHelp:
      "Any HTTPS address that accepts a JSON POST. Answer with a 2xx; Peer tries again after a timeout, a 429 or a 5xx, and gives up on any other reply.",
  },
};

const OTHER_FORMAT_COPY: FormatCopy = {
  namePlaceholder: "Our webhook",
  urlPlaceholder: "https://…",
  urlHelp: null,
};

/** The copy of a format, whichever one the webhook has. */
export const formatCopy = (format: string): FormatCopy =>
  isFormat(format) ? FORMAT_COPY[format] : OTHER_FORMAT_COPY;

/** The headers every delivery carries, which a receiver checks the signature with (Standard Webhooks). */
export const SIGNATURE_HEADERS = ["webhook-id", "webhook-timestamp", "webhook-signature"] as const;

/**
 * What a generic webhook is sent, as an example of one delivery: the envelope the Hub writes
 * (`version`, `id`, `type`, `createdAt`, `workspace`, `project`, `title`, `actor`, `url`, `data`),
 * with the fields of a `task.review` event. The Hub leaves out a field with no value, and sends `url`
 * only for an event with a link (a merged pull request), so the example has none.
 */
export function genericPayloadSample(input: {
  readonly workspace: { readonly slug: string; readonly name: string };
  /** Who the event names: the person who moved the task. */
  readonly actor: string;
}): string {
  const text = (value: string) => JSON.stringify(value);
  return [
    "{",
    `  "version": 1,`,
    `  "id": ${text("[delivery id]")},`,
    `  "type": "task.review",`,
    `  "createdAt": "2026-10-12T14:02:11Z",`,
    `  "workspace": { "slug": ${text(input.workspace.slug)}, "name": ${text(input.workspace.name)} },`,
    `  "project": { "id": "booking", "name": "Booking" },`,
    `  "title": "Order notes header",`,
    `  "actor": ${text(input.actor)},`,
    `  "data": { "task": ${text("[task id]")}, "key": "BKG-7", "to": "review", "by": "agent" }`,
    "}",
  ].join("\n");
}

/** What follows the example: the Hub drops empty fields, and says where `url` comes from. */
export const PAYLOAD_NOTE =
  "A field with no value is left out. url is there when the event has a link, such as a merged pull request.";

// ---- words ----------------------------------------------------------------------------------------

export const URL_HINT = "https only. Saved as a secret, never shown again.";

export const projectsAllNote = (workspaceName: string): string =>
  `Gets projects open to all of ${workspaceName} and shared projects, not ones with selected people.`;

/** What the delete is told, since it takes the webhook's history too. */
export const DELETE_NOTE = "Its delivery history goes too.";

/** What the signing switch says: why it is on, and with which secret. */
export function signingText(names: ReadonlyArray<string>, stored: ReadonlySet<string>): string {
  if (names.length === 0) return "A generic webhook is signed, so its receiver can verify it.";
  const list = names.join(" and ");
  const missing = names.filter((name) => !stored.has(name));
  return missing.length === 0
    ? `With the secret${names.length === 1 ? "" : "s"} ${list} · stored`
    : `With the secret${names.length === 1 ? "" : "s"} ${list} · not stored yet`;
}
