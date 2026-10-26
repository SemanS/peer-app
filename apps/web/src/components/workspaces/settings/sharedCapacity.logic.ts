/**
 * What the Shared capacity page works out, apart from how it draws (design artboard 16): the
 * gateway and its currency as the settings document holds them and the writes that change them, the
 * sync banner, the sentences about the master key and the connection test, and the model pools as
 * a table of the gateway's models against the pools that hold them. The Hub decides every change
 * again (design H3: admins alone change the gateway, the currency and the pools); these only keep
 * the page from offering what it would refuse.
 */
import { getAt, harnessLabel } from "@t3tools/client-runtime/peer-settings";
import type { PeerSettingsSync } from "@t3tools/contracts";

import { projectIdFromName } from "./newProject.logic";
import { isPeriod, joinNames, periodNoun } from "./projectCapacity.logic";
import { formatMoney } from "./shared.logic";

type Mapping = Readonly<Record<string, unknown>>;
const isMapping = (value: unknown): value is Mapping =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A write to the draft, at a path from the document's root; `undefined` removes the node. */
export interface Edit {
  readonly path: ReadonlyArray<string>;
  readonly value: unknown;
}

export const CURRENCIES = ["EUR", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const isCurrency = (value: unknown): value is Currency => value === "EUR" || value === "USD";

/** The workspace's currency: EUR unless the document says USD, as the Hub reads one. */
export function readCurrency(document: unknown): Currency {
  const currency = getAt(document, ["currency"]);
  return isCurrency(currency) ? currency : "EUR";
}

/** The name the Hub gives the secret that holds the master key, until the document says another. */
export const DEFAULT_KEY_SECRET = "litellm-master-key";

export interface GatewaySettings {
  /** What agents use as their base address. */
  readonly url: string;
  /** Where the Hub reaches the admin API when it is not `url`. */
  readonly adminUrl: string | undefined;
  /** US dollars per one unit of the workspace's currency. */
  readonly usdPerUnit: number;
  /** The workspace secret holding the master key. */
  readonly masterKeySecret: string;
}

/** The gateway the document holds; undefined where the workspace has none yet. */
export function readGateway(document: unknown): GatewaySettings | undefined {
  const node = getAt(document, ["gateway"]);
  if (!isMapping(node) || typeof node.url !== "string") return undefined;
  const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);
  return {
    url: node.url,
    adminUrl: text(node.adminUrl),
    usdPerUnit:
      typeof node.usdPerUnit === "number" && Number.isFinite(node.usdPerUnit) && node.usdPerUnit > 0
        ? node.usdPerUnit
        : 1,
    masterKeySecret: text(node.masterKeySecret) ?? DEFAULT_KEY_SECRET,
  };
}

const ADDRESS = /^https?:\/\/\S+$/i;

/** Why `text` is not the gateway's address; null where it is one. An empty field is a problem too: the gateway needs one. */
export function gatewayUrlProblem(text: string): string | null {
  const url = text.trim();
  if (url === "") return "The gateway needs an address, like https://llm.acme.dev.";
  return ADDRESS.test(url) ? null : "An address starting with https:// or http://.";
}

/** The admin address is optional: nothing typed is fine, anything typed is an address. */
export function adminUrlProblem(text: string): string | null {
  return text.trim() === "" ? null : gatewayUrlProblem(text);
}

export type Rate =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly problem: string };

/** A rate as it is typed: a number above zero, with a `.` or a `,`. */
export function parseRate(text: string): Rate {
  const trimmed = text.trim();
  const value = /^\d+(?:[.,]\d{1,6})?$/.test(trimmed)
    ? Number(trimmed.replace(",", "."))
    : Number.NaN;
  return value > 0
    ? { ok: true, value }
    : { ok: false, problem: "A rate is a number above zero, like 1.08." };
}

/**
 * The writes for a typed address. The first one makes the gateway (LiteLLM, a rate of 1 and the
 * Hub's name for the key); after that it changes the address alone.
 */
export function urlEdits(gateway: GatewaySettings | undefined, url: string): ReadonlyArray<Edit> {
  const address = url.trim();
  return gateway === undefined
    ? [
        {
          path: ["gateway"],
          value: {
            kind: "litellm",
            url: address,
            usdPerUnit: 1,
            masterKeySecret: DEFAULT_KEY_SECRET,
          },
        },
      ]
    : [{ path: ["gateway", "url"], value: address }];
}

export const adminUrlEdit = (text: string): Edit => ({
  path: ["gateway", "adminUrl"],
  value: text.trim() === "" ? undefined : text.trim(),
});

export const rateEdit = (value: number): Edit => ({ path: ["gateway", "usdPerUnit"], value });

/**
 * The writes for choosing a currency. In dollars a dollar is a dollar, so the gateway's rate is set
 * to 1; going back to euros restores the rate that was saved for them, and with none the rate stays
 * for the person to enter.
 */
export function currencyEdits(input: {
  readonly to: Currency;
  readonly gateway: GatewaySettings | undefined;
  readonly saved: { readonly currency: Currency; readonly usdPerUnit: number | undefined };
}): ReadonlyArray<Edit> {
  const { to, gateway, saved } = input;
  const edits: Edit[] = [{ path: ["currency"], value: to }];
  if (gateway === undefined) return edits;
  if (to === "USD") {
    if (gateway.usdPerUnit !== 1) edits.push(rateEdit(1));
  } else if (
    saved.currency === "EUR" &&
    saved.usdPerUnit !== undefined &&
    saved.usdPerUnit !== gateway.usdPerUnit
  ) {
    edits.push(rateEdit(saved.usdPerUnit));
  }
  return edits;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** "2 Oct", and "2 Oct 2025" for another year: how the design writes a date. */
export function shortDate(iso: string, now: Date): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** A moment as the page words it: the time, and the date unless it was today. Null for a time that is none. */
export function moment(
  iso: string,
  now: Date,
  clock: (iso: string) => string,
): { readonly date: string | null; readonly time: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return { date: sameDay(date, now) ? null : shortDate(iso, now), time: clock(iso) };
}

export type SyncState =
  | {
      readonly kind: "failed";
      /** "at 12:04", or "on 2 Oct at 12:04". */
      readonly when: string;
      readonly error: string;
      /** When the gateway last had the settings, "11:20" or "2 Oct 11:20"; null if it never did. */
      readonly lastOk: string | null;
    }
  | { readonly kind: "ok"; readonly ago: string }
  | { readonly kind: "never" };

const withoutFullStop = (text: string) => text.trim().replace(/[.\s]+$/, "");

/**
 * Where the last reconciliation with the gateway stands: it failed (and the limits there are from
 * the one before), it worked, or none has run. `clock` writes a time of day as the person reads
 * them, `ago` how long since.
 */
export function syncState(
  sync: PeerSettingsSync | null | undefined,
  format: {
    readonly now: Date;
    readonly clock: (iso: string) => string;
    readonly ago: (iso: string) => string;
  },
): SyncState {
  if (sync === null || sync === undefined) return { kind: "never" };
  if (sync.ok) return { kind: "ok", ago: format.ago(sync.at) };
  const failed = moment(sync.at, format.now, format.clock);
  const last =
    sync.lastOkAt === null || sync.lastOkAt === undefined
      ? null
      : moment(sync.lastOkAt, format.now, format.clock);
  return {
    kind: "failed",
    when:
      failed === null
        ? "just now"
        : failed.date === null
          ? `at ${failed.time}`
          : `on ${failed.date} at ${failed.time}`,
    error:
      sync.error === undefined || withoutFullStop(sync.error) === ""
        ? "the gateway did not answer"
        : withoutFullStop(sync.error),
    lastOk: last === null ? null : last.date === null ? last.time : `${last.date} ${last.time}`,
  };
}

/** What follows "Last sync failed at 12:04: <error>.": that the settings are safe and what the gateway has. */
export function syncConsequence(lastOk: string | null): string {
  return lastOk === null
    ? "Settings are saved, but nothing has reached the gateway yet."
    : `Settings are saved, but limits on the gateway are from ${lastOk}.`;
}

/** What the card says of the key: that it is stored and by whom, never the key. */
export function masterKeyText(
  key: {
    readonly stored: boolean;
    readonly at?: string | null | undefined;
    readonly by?: { readonly email: string; readonly name: string } | null | undefined;
  },
  nameOf: (person: { readonly email: string; readonly name: string }) => string,
  now: Date,
): string {
  if (!key.stored) return "No key stored yet. The Hub needs it to manage keys on the gateway.";
  const who = key.by === null || key.by === undefined ? null : nameOf(key.by);
  const when = key.at === null || key.at === undefined ? null : shortDate(key.at, now);
  const set =
    who !== null && when !== null
      ? `Stored · set by ${who} on ${when}.`
      : who !== null
        ? `Stored · set by ${who}.`
        : when !== null
          ? `Stored · set on ${when}.`
          : "Stored.";
  return `${set} Never shown again.`;
}

/** The key as a person may type it: no stray whitespace around it; null where nothing is left. */
export function keyValue(typed: string): string | null {
  const key = typed.trim();
  return key === "" || key.length > 8192 || /[\r\n\0]/.test(key) ? null : key;
}

export interface TestOutcome {
  readonly tone: "ok" | "error";
  readonly text: string;
  /** The models the gateway has, when it answered. */
  readonly models: ReadonlyArray<string> | null;
}

/** What a test of the connection found. */
export function testOutcome(result: {
  readonly ok: boolean;
  readonly models?: ReadonlyArray<string> | undefined;
  readonly error?: string | undefined;
}): TestOutcome {
  if (!result.ok) {
    const error = result.error === undefined ? "" : withoutFullStop(result.error);
    return {
      tone: "error",
      text:
        error === ""
          ? "Could not connect: the gateway did not answer."
          : `Could not connect: ${error}.`,
      models: null,
    };
  }
  const models = result.models ?? [];
  return {
    tone: "ok",
    text: `Connected · the key works · ${models.length} ${models.length === 1 ? "model" : "models"}`,
    models,
  };
}

/** A model of a pool, with everything its entry says (the Hub keeps what the page does not name). */
export interface PoolModel {
  readonly id: string;
  readonly raw: Mapping;
}

export interface Pool {
  readonly id: string;
  readonly name: string;
  readonly models: ReadonlyArray<PoolModel>;
}

/** The pools of the document's `capacity` section, in the Hub's order. */
export function readCatalogPools(document: unknown): ReadonlyArray<Pool> {
  const section = getAt(document, ["capacity"]);
  if (!isMapping(section)) return [];
  return Object.entries(section).flatMap(([id, pool]) => {
    if (!isMapping(pool)) return [];
    const models = Array.isArray(pool.models) ? pool.models : [];
    return [
      {
        id,
        name: typeof pool.name === "string" && pool.name !== "" ? pool.name : id,
        models: models.flatMap((model: unknown) =>
          isMapping(model) && typeof model.id === "string" ? [{ id: model.id, raw: model }] : [],
        ),
      },
    ];
  });
}

/**
 * Which agents can use a model, from its name: Claude Code runs Anthropic's, Codex and OpenCode
 * OpenAI's (`gpt-…`, and the `o3`-style reasoning models), and any other model is one OpenCode
 * reaches through the gateway.
 */
export function harnessFor(modelId: string): ReadonlyArray<string> {
  if (/^claude-/i.test(modelId)) return ["claude"];
  if (/^(gpt-|o\d)/i.test(modelId)) return ["codex", "opencode"];
  return ["opencode"];
}

/** Whose model it is, as the Hub names providers. */
export function providerFor(modelId: string): string {
  if (/^claude-/i.test(modelId)) return "anthropic";
  if (/^(gpt-|o\d)/i.test(modelId)) return "openai";
  if (/^gemini-/i.test(modelId)) return "gemini";
  return "openai-compatible";
}

/** A model the pools do not hold yet, as its first pool gets it. */
export const newModelEntry = (modelId: string): Mapping => ({
  id: modelId,
  provider: providerFor(modelId),
  harness: harnessFor(modelId),
});

/** One line of the table: a model the gateway has or a pool holds, and the pools that hold it. */
export interface ModelRow {
  readonly id: string;
  /** The harnesses the pools say it is for; what its name suggests while no pool holds it. */
  readonly harness: ReadonlyArray<string>;
  readonly inPools: ReadonlySet<string>;
  /** A test found the gateway without it, though a pool lists it. */
  readonly missing: boolean;
}

/**
 * The models the gateway has (from the last test), then those only a pool lists. Without a test only
 * the pools' models are known.
 */
export function modelRows(
  pools: ReadonlyArray<Pool>,
  onGateway: ReadonlyArray<string> | null,
): ReadonlyArray<ModelRow> {
  const ids = [
    ...new Set([...(onGateway ?? []), ...pools.flatMap((pool) => pool.models.map(({ id }) => id))]),
  ];
  return ids.map((id) => {
    const entries = pools.flatMap((pool) => pool.models.filter((model) => model.id === id));
    const harness = [
      ...new Set(
        entries.flatMap(({ raw }) =>
          Array.isArray(raw.harness)
            ? raw.harness.filter((name): name is string => typeof name === "string")
            : [],
        ),
      ),
    ];
    return {
      id,
      harness: entries.length === 0 ? harnessFor(id) : harness,
      inPools: new Set(
        pools.filter((pool) => pool.models.some((m) => m.id === id)).map((p) => p.id),
      ),
      missing: onGateway !== null && !onGateway.includes(id),
    };
  });
}

/** "Claude Code", "Codex, OpenCode". */
export const harnessText = (harness: ReadonlyArray<string>): string =>
  harness.length === 0 ? "—" : harness.map(harnessLabel).join(", ");

/**
 * A pool's models once a model is added to it or taken out. An added model is written as another
 * pool already has it (its provider, upstream name and key variable are the same model's), else from
 * its name; it goes last, as the Hub writes new items.
 */
export function poolModelsWith(
  pool: Pool,
  pools: ReadonlyArray<Pool>,
  modelId: string,
  on: boolean,
): ReadonlyArray<unknown> {
  const kept = pool.models.filter((model) => model.id !== modelId).map((model) => model.raw);
  if (!on) return kept;
  const here = pool.models.find((model) => model.id === modelId);
  if (here !== undefined) return pool.models.map((model) => model.raw);
  const known = pools.flatMap((other) => other.models).find((model) => model.id === modelId);
  return [...kept, known?.raw ?? newModelEntry(modelId)];
}

/** What the people who change the pools are told about a pool with no model: the Hub refuses it. */
export function emptyPoolsText(pools: ReadonlyArray<Pool>): string | null {
  const names = pools.filter((pool) => pool.models.length === 0).map((pool) => pool.name);
  if (names.length === 0) return null;
  return `${joinNames(names)} ${names.length === 1 ? "has" : "have"} no models yet. A pool needs at least one.`;
}

/**
 * Who spends each pool: "Standard is used by Booking (€600 a month) and Peer Hub (€400 a month).",
 * one sentence for each pool a project has a budget in.
 */
export function poolUses(document: unknown, currency: Currency): ReadonlyArray<string> {
  const projects = getAt(document, ["projects"]);
  const all = isMapping(projects) ? Object.values(projects) : [];
  return readCatalogPools(document).flatMap((pool) => {
    const users = all.flatMap((project) => {
      if (getAt(project, ["capacity", "shared", "pool"]) !== pool.id) return [];
      const amount = getAt(project, ["capacity", "shared", "budget", "amount"]);
      const period = getAt(project, ["capacity", "shared", "budget", "period"]);
      const name = getAt(project, ["name"]);
      if (typeof amount !== "number" || typeof name !== "string") return [];
      const per = `a ${periodNoun(isPeriod(period) ? period : "month")}`;
      return [`${name} (${formatMoney(amount, currency)} ${per})`];
    });
    return users.length === 0 ? [] : [`${pool.name} is used by ${joinNames(users)}.`];
  });
}

/** The longest id the Hub takes. */
const ID_MAX = 48;

export type NewPool =
  | { readonly ok: true; readonly id: string; readonly name: string }
  | { readonly ok: false; readonly problem: string | null };

/**
 * Whether a name and an id make a pool: a name, and an id of lowercase letters and digits joined by
 * hyphens that no pool has. Nothing is said while the name is empty.
 */
export function checkNewPool(input: {
  readonly name: string;
  readonly id: string;
  readonly taken: ReadonlySet<string>;
}): NewPool {
  const name = input.name.trim();
  const id = input.id.trim();
  if (name === "") return { ok: false, problem: null };
  if (id === "") {
    return {
      ok: false,
      problem: "Include a letter (a-z) or digit in the name so Peer can create an ID.",
    };
  }
  if (id.length > ID_MAX || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    return {
      ok: false,
      problem: "An ID is lowercase letters and digits joined by hyphens, like standard.",
    };
  }
  if (input.taken.has(id)) {
    return { ok: false, problem: `A pool with the ID “${id}” exists already. Pick another.` };
  }
  return { ok: true, id, name };
}

/** The id a name makes, as the new project form makes one. */
export const poolIdFromName = projectIdFromName;

/** The pool a person creates: a name and no models yet, which they tick in the table before saving. */
export const newPoolEdit = (id: string, name: string): Edit => ({
  path: ["capacity", id],
  value: { name, models: [] },
});

/** What the manifest says of the gateway: the address projects with a budget use, and the currency. */
export function manifestGateway(
  projects: ReadonlyArray<{
    readonly project: {
      readonly capacity: { readonly shared?: { readonly gatewayUrl: string } | undefined };
    };
  }>,
): string | undefined {
  return projects.find(({ project }) => project.capacity.shared !== undefined)?.project.capacity
    .shared?.gatewayUrl;
}
