/**
 * Peer's settings, as the pages of the settings area reason about them: a draft of the settings
 * document turned into the sets a save sends, where a value comes from, what a coordination
 * decision was.
 * Pure, and free of what Hermes lacks, so web and mobile share it.
 *
 * The Hub decides all of this too (the rules are its `coord/rules.rs` and the app's `hubPolicy.ts`);
 * what is here is how the pages show it before and after it asks.
 *
 * @module peerSettings
 */
import {
  PeerSettingsPersonEntry,
  PeerSettingsProject,
  PeerSettingsTool,
  type PeerSettingsSet,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

type Path = ReadonlyArray<string>;
const isMapping = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The node of a document at `path`, or undefined where there is none. Only mappings are entered. */
export function getAt(document: unknown, path: Path): unknown {
  let node = document;
  for (const key of path) {
    if (!isMapping(node) || !Object.hasOwn(node, key)) return undefined;
    node = node[key];
  }
  return node;
}

/**
 * `document` with the node at `path` set to `value` (removed for undefined), copying only the
 * mappings on the way, so an unchanged part keeps its identity. Keys are data, `__proto__` too.
 */
export function setAt<T>(document: T, path: Path, value: unknown): T {
  const [key, ...rest] = path;
  if (key === undefined) return value as T;
  const node: Readonly<Record<string, unknown>> = isMapping(document) ? document : {};
  const present = Object.hasOwn(node, key);
  const next = setAt(present ? node[key] : undefined, rest, value);
  const entries = Object.entries(node);
  return Object.fromEntries(
    next === undefined
      ? entries.filter(([name]) => name !== key)
      : present
        ? entries.map(([name, current]) => (name === key ? [name, next] : [name, current]))
        : [...entries, [key, next]],
  ) as T;
}

const absent = (value: unknown) => value === undefined || value === null;

/**
 * Whether two JSON values are the same: objects whatever the order of their keys, lists in order,
 * and a missing value and `null` alike (the Hub removes a node that is set to `null`).
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (absent(a) || absent(b)) return absent(a) && absent(b);
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => jsonEqual(item, b[i]))
    );
  }
  if (isMapping(a) && isMapping(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((key) =>
      jsonEqual(
        Object.hasOwn(a, key) ? a[key] : undefined,
        Object.hasOwn(b, key) ? b[key] : undefined,
      ),
    );
  }
  return a === b;
}

/**
 * The sets that turn `base` into `draft` at `paths`: one for each path whose value changed, the
 * draft's whole value there (`null` where the draft has none, which removes the node), in the
 * order of `paths`. The page names the granularity it edits at and the Hub merges the rest, so a
 * path whose ancestor is set too is left to the ancestor.
 */
export function setsFor(
  base: unknown,
  draft: unknown,
  paths: ReadonlyArray<Path>,
): PeerSettingsSet[] {
  const sets: PeerSettingsSet[] = [];
  for (const path of paths) {
    const value = getAt(draft, path);
    if (!jsonEqual(getAt(base, path), value) && !sets.some((set) => within(set.path, path))) {
      sets.push({ path, value: value === undefined ? null : value });
    }
  }
  return sets.filter((set) => !sets.some((other) => other !== set && within(other.path, set.path)));
}

/** Whether `inner` is `outer` or below it. */
const within = (outer: Path, inner: Path) =>
  outer.length <= inner.length && outer.every((key, i) => key === inner[i]);

export interface EffectivePolicy {
  readonly value: string;
  readonly source: "project" | "computer";
  /** What this computer set, which the project's own policy beats: shown struck through. */
  readonly overridden?: { readonly value: string };
}

/**
 * The coordination policy that counts in a project: its own, where it sets one, else this
 * computer's default. `policies` has each project's own policy by id (`policiesOf`).
 */
export function effectivePolicy(
  policies: Readonly<Record<string, string | undefined>>,
  project: string,
  computerDefault: string,
): EffectivePolicy {
  const own = Object.hasOwn(policies, project) ? policies[project] : undefined;
  if (own === undefined) return { value: computerDefault, source: "computer" };
  return own === computerDefault
    ? { value: own, source: "project" }
    : { value: own, source: "project", overridden: { value: computerDefault } };
}

/** Each project's own coordination policy by id, absent where it sets none. */
export const policiesOf = (
  projects: Readonly<Record<string, { readonly coordination?: { readonly policy?: string } }>>,
): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(projects).map(([id, p]) => [id, p.coordination?.policy]));

/** What the Hub records of the policy that decided an overlap or a ledger event. */
export interface PolicyDecision {
  readonly policy: string;
  /** `project` (its policy or a path rule) or `client` (this computer's default). */
  readonly source: "project" | "client";
  readonly pattern?: string | undefined;
  readonly pathRulesOff?: boolean | undefined;
}

/** The parts of a decision in words: what the chip and the text both say. */
export interface DecisionParts {
  readonly policy: string;
  /** Where it came from: `payments/** in Booking`, `Booking's policy`, `your computer, Camp-bot has no policy`. */
  readonly from: string;
  /** The project has path rules the Hub did not apply. */
  readonly pathRulesOff: boolean;
}

/**
 * A decision in parts. A `client` decision is the default of the computer that asked: `computer`
 * says whether that is this one (`yours`, the default) or another, which the words then say.
 */
export function decisionParts(
  decision: PolicyDecision,
  projectName?: string,
  computer: "yours" | "another" = "yours",
): DecisionParts {
  const project = projectName ?? "the project";
  const from =
    decision.source === "client"
      ? `${computer === "yours" ? "your computer" : "another computer's default"}, ${project} has no policy`
      : decision.pattern !== undefined
        ? `${decision.pattern} in ${project}`
        : `${projectName === undefined ? "the project" : projectName}'s policy`;
  return { policy: decision.policy, from, pathRulesOff: decision.pathRulesOff === true };
}

/**
 * A decision in words: `coordinate · payments/** in Booking`, `coordinate · Booking's policy`,
 * `ask · your computer, Camp-bot has no policy`, with `· path rules were off` when the project has
 * path rules the Hub does not apply. Null for a row of an older Hub, which records none.
 */
export function decisionText(
  decision: PolicyDecision | null | undefined,
  projectName?: string,
  computer: "yours" | "another" = "yours",
): string | null {
  if (decision === null || decision === undefined) return null;
  const { policy, from, pathRulesOff } = decisionParts(decision, projectName, computer);
  return [policy, from, ...(pathRulesOff ? ["path rules were off"] : [])].join(" · ");
}

const HARNESSES: Readonly<Record<string, string>> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok",
  opencode: "OpenCode",
  antigravity: "Antigravity",
};
export const harnessLabel = (harness: string) => HARNESSES[harness] ?? harness;

const decodePerson = Schema.decodeUnknownOption(PeerSettingsPersonEntry);
const decodeProject = Schema.decodeUnknownOption(PeerSettingsProject);
const decodeTool = Schema.decodeUnknownOption(PeerSettingsTool);

const entriesOf = <A>(section: unknown, decode: (raw: unknown) => Option.Option<A>) =>
  Object.fromEntries(
    isMapping(section)
      ? Object.entries(section).flatMap(([id, raw]) => {
          const read = decode(raw);
          return Option.isSome(read) ? [[id, read.value] as const] : [];
        })
      : [],
  ) as Record<string, A>;

/**
 * The parts of a settings document the pages read, each entry as its narrow schema reads it; an
 * entry that does not read (a newer Hub's shape) is left out, and every key the schema does not
 * name is kept.
 */
export function readDocument(document: Readonly<Record<string, unknown>>) {
  return {
    people: entriesOf(document.people, decodePerson),
    projects: entriesOf(document.projects, decodeProject),
    tools: entriesOf(document.tools, decodeTool),
  };
}
