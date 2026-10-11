/**
 * Peer's settings, as the pages of the settings area reason about them: a draft of the settings
 * document turned into the sets a save sends, where a value comes from, what a coordination
 * decision was, which path rule decides a file, what a person's plans may do in a project.
 * Pure, and free of what Hermes lacks, so web and mobile share it.
 *
 * The Hub decides all of this too (the rules are its `coord/rules.rs` and the app's `hubPolicy.ts`);
 * what is here is how the pages show it before and after it asks.
 *
 * @module peerSettings
 */
import {
  PeerSettingsPersonEntry,
  PeerSettingsPool,
  PeerSettingsProject,
  PeerSettingsTool,
  PeerSettingsWebhook,
  type PeerSettingsSet,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

type Path = ReadonlyArray<string>;
const isMapping = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// ---- the draft ---------------------------------------------------------------------------------

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

// ---- where a value comes from -------------------------------------------------------------------

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

/**
 * A decision in words: `coordinate · payments/** in Booking`, `coordinate · Booking's policy`,
 * `ask · your computer, Camp-bot has no policy`, with `· path rules were off` when the project has
 * path rules the Hub does not apply. Null for a row of an older Hub, which records none.
 */
export function decisionText(
  decision: PolicyDecision | null | undefined,
  projectName?: string,
): string | null {
  if (decision === null || decision === undefined) return null;
  const project = projectName ?? "the project";
  const from =
    decision.source === "client"
      ? `your computer, ${project} has no policy`
      : decision.pattern !== undefined
        ? `${decision.pattern} in ${project}`
        : `${projectName === undefined ? "the project" : projectName}'s policy`;
  return [
    decision.policy,
    from,
    ...(decision.pathRulesOff === true ? ["path rules were off"] : []),
  ].join(" · ");
}

// ---- path rules (a twin of the Hub's coord/rules.rs, whose vectors its tests run) -----------------

export interface PathRule {
  readonly pattern: string;
  readonly policy: string;
}
/** A project's rules as the document holds them (pattern → policy) or as a list. */
export type PathRules = ReadonlyArray<PathRule> | Readonly<Record<string, string>>;

const ruleList = (rules: PathRules): ReadonlyArray<PathRule> =>
  Array.isArray(rules)
    ? (rules as ReadonlyArray<PathRule>)
    : Object.entries(rules as Readonly<Record<string, string>>).map(([pattern, policy]) => ({
        pattern,
        policy,
      }));

const isControl = (char: string) => {
  const code = char.codePointAt(0)!;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
};

/**
 * Why `glob` is not a pattern a project may give a policy, in the Hub's words; null when it is
 * one. `*` matches within a segment, a segment that is `**` any number of segments.
 */
export function validatePathPattern(glob: string): string | null {
  if (glob === "") return "a pattern is not empty";
  const chars = [...glob];
  if (chars.length > 200) return "a pattern is at most 200 characters";
  if (chars.some(isControl)) return "a pattern has no control characters";
  const unsupported = chars.find((char) => "?[]{}!".includes(char));
  if (unsupported !== undefined) {
    return `\`${unsupported}\` is not supported: the wildcards are \`*\` within a segment and \`**\` for segments`;
  }
  if (glob.includes("\\")) return "segments are separated by `/`, not `\\`";
  if (glob.includes(":")) return "a pattern has no `:`";
  if (glob.startsWith("/")) return "a pattern is relative to the repository: no leading `/`";
  if (glob.endsWith("/")) {
    return "a pattern names files: no trailing `/` (`dir/**` is everything in `dir`)";
  }
  for (const segment of glob.split("/")) {
    if (segment === "") return "a pattern has no empty segment (`//`)";
    if (segment === "." || segment === "..") return "a pattern has no `.` or `..` segment";
    if (segment !== "**" && segment.includes("**")) {
      return "`**` is a whole segment (`a/**/b`), not part of one";
    }
  }
  return null;
}

/** A segment of a pattern against one of a path: `*` is any characters, the rest literal. */
function segmentMatches(part: string, segment: string): boolean {
  const chars = [...segment];
  let reach = Array.from({ length: chars.length + 1 }, (_, i) => i === 0);
  for (const wanted of part) {
    const next = Array.from({ length: chars.length + 1 }, () => false);
    if (wanted === "*") {
      let any = false;
      reach.forEach((at, j) => {
        any ||= at;
        next[j] = any;
      });
    } else {
      chars.forEach((char, j) => {
        next[j + 1] = reach[j]! && char === wanted;
      });
    }
    reach = next;
  }
  return reach[chars.length]!;
}

/**
 * Whether `glob` (a valid pattern) matches `path`, a repository path (a trailing `/`, a claimed
 * directory, is ignored): a dynamic program over both lengths, never backtracking.
 */
export function matchesPattern(glob: string, path: string): boolean {
  const segments = (path.endsWith("/") ? path.slice(0, -1) : path).split("/");
  let reach = Array.from({ length: segments.length + 1 }, (_, i) => i === 0);
  for (const part of glob.split("/")) {
    const next = Array.from({ length: segments.length + 1 }, () => false);
    if (part === "**") {
      let any = false;
      reach.forEach((at, j) => {
        any ||= at;
        next[j] = any;
      });
    } else {
      segments.forEach((segment, j) => {
        next[j + 1] = reach[j]! && segmentMatches(part, segment);
      });
    }
    reach = next;
  }
  return reach[segments.length]!;
}

const compareCodePoints = (a: string, b: string) => {
  const left = [...a];
  const right = [...b];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const delta = left[i]!.codePointAt(0)! - right[i]!.codePointAt(0)!;
    if (delta !== 0) return delta;
  }
  return left.length - right.length;
};

/**
 * The order the Hub ranks patterns in, best first: more literal characters (all but `*`, `/`
 * included), then fewer `**` segments, then fewer other `*`, then the pattern that sorts first.
 * A file's pattern beats its directory's, and `src/payments/**` beats `src/**`.
 */
export function comparePatterns(a: string, b: string): number {
  const rank = (glob: string) => {
    const segments = glob.split("/");
    return [
      -[...glob].filter((char) => char !== "*").length,
      segments.filter((segment) => segment === "**").length,
      segments.reduce(
        (count, segment) => (segment === "**" ? count : count + segment.split("*").length - 1),
        0,
      ),
    ] as const;
  };
  const [x, y] = [rank(a), rank(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || compareCodePoints(a, b);
}

/** The rules best first, as the Hub lists a project's. */
export const rankedPathRules = (rules: PathRules): ReadonlyArray<PathRule> =>
  [...ruleList(rules)].sort((a, b) => comparePatterns(a.pattern, b.pattern));

/** A path as the Hub reads one: relative, forward slashes, `.` and empty segments dropped; undefined when it is none. */
export function repositoryPath(path: string): string | undefined {
  const text = path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    text === "" ||
    text.length > 300 ||
    text.startsWith("/") ||
    text.includes(":") ||
    [...text].some(isControl) ||
    text.split("/").includes("..")
  ) {
    return undefined;
  }
  const normal = text
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/");
  return normal === "" ? undefined : text.endsWith("/") ? `${normal}/` : normal;
}

/**
 * The most specific of the rules that matches `path`, the one that decides it; a pattern that is
 * not valid decides nothing. Undefined when none matches (the project's own policy decides).
 */
export function pathRuleFor(path: string, rules: PathRules): PathRule | undefined {
  const target = repositoryPath(path);
  if (target === undefined) return undefined;
  return rankedPathRules(rules).find(
    ({ pattern }) => validatePathPattern(pattern) === null && matchesPattern(pattern, target),
  );
}

// ---- shared capacity and plans --------------------------------------------------------------------

/** What a person may spend in a project: their own cap, else the project's default for everyone. */
export function allocationOf(
  project: {
    readonly capacity?: {
      readonly shared?: {
        readonly allocations?: Readonly<Record<string, number>> | undefined;
        readonly defaultAllocation?: number | undefined;
      };
    };
  },
  email: string,
): { readonly value: number | undefined; readonly source: "custom" | "project default" } {
  const shared = project.capacity?.shared;
  const own =
    shared?.allocations !== undefined && Object.hasOwn(shared.allocations, email)
      ? shared.allocations[email]
      : undefined;
  return own === undefined
    ? { value: shared?.defaultAllocation, source: "project default" }
    : { value: own, source: "custom" };
}

export type PlanClass = "consumer" | "commercial" | "other";

/** Pro, Max and Plus are consumer plans; Team, Business, Enterprise and an API key are commercial. */
export function planClass(plan: string): PlanClass {
  switch (plan.toLowerCase()) {
    case "pro":
    case "max":
    case "plus":
      return "consumer";
    case "team":
    case "business":
    case "enterprise":
    case "api":
      return "commercial";
    default:
      return "other";
  }
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
export const planLabel = (plan: string) =>
  plan === "api" ? "API key" : `${plan.charAt(0).toUpperCase()}${plan.slice(1)}`;

export interface PersonalPlan {
  readonly harness: string;
  readonly plan: string;
}

export interface ProjectUse {
  readonly project: string;
  readonly name: string;
  /** What the project allows of personal plans: any, commercial ones only, or none (shared capacity only). */
  readonly rule: "any" | "commercial" | "none";
  readonly ruleText: string;
  /** The project has shared capacity to use instead. */
  readonly shared: boolean;
  readonly plans: ReadonlyArray<{
    readonly harness: string;
    readonly plan: string;
    readonly class: PlanClass;
    readonly usable: boolean;
    /** Why not, when it is not. */
    readonly reason?: string;
  }>;
}

const RULE_TEXTS = {
  any: "Any plan",
  commercial: "Commercial plans only",
  none: "Shared capacity only",
} as const;

/**
 * Where each of a person's plans may be used: a project that allows `any` takes every plan, one
 * that allows `commercial` only the commercial ones (a consumer or unknown plan is blocked there),
 * one that allows `none` no personal plan. The rules are `hubPolicy.ts`'s, which keeps deciding.
 * With `email`, only the projects that person is on.
 */
export function whereUsable(
  projects: Readonly<
    Record<
      string,
      {
        readonly name: string;
        readonly client?: string | undefined;
        readonly members?: ReadonlyArray<string> | undefined;
        readonly capacity?:
          | { readonly personal?: string | undefined; readonly shared?: unknown }
          | undefined;
      }
    >
  >,
  plans: ReadonlyArray<PersonalPlan>,
  email?: string,
): ReadonlyArray<ProjectUse> {
  return Object.entries(projects)
    .filter(
      ([, project]) =>
        email === undefined ||
        project.members?.some(
          (member) => member === "*" || member.toLowerCase() === email.toLowerCase(),
        ) !== false,
    )
    .map(([id, project]) => {
      const personal = project.capacity?.personal;
      const rule = personal === "commercial" || personal === "none" ? personal : "any";
      const work = project.client === undefined ? "" : `is client work for ${project.client} and `;
      return {
        project: id,
        name: project.name,
        rule,
        ruleText: RULE_TEXTS[rule],
        shared: project.capacity?.shared !== undefined && project.capacity.shared !== null,
        plans: plans.map(({ harness, plan }) => {
          const kind = planClass(plan);
          const base = { harness, plan, class: kind };
          if (rule === "any" || (rule === "commercial" && kind === "commercial")) {
            return { ...base, usable: true };
          }
          const reason =
            rule === "none"
              ? `${project.name} runs on shared capacity only.`
              : `${project.name} ${work}allows commercial plans only. ${planLabel(plan)} is ${kind === "consumer" ? "a consumer plan" : "not a commercial plan"}.`;
          return { ...base, usable: false, reason };
        }),
      };
    });
}

// ---- reading the document ---------------------------------------------------------------------------

const decodePerson = Schema.decodeUnknownOption(PeerSettingsPersonEntry);
const decodeProject = Schema.decodeUnknownOption(PeerSettingsProject);
const decodeTool = Schema.decodeUnknownOption(PeerSettingsTool);
const decodePool = Schema.decodeUnknownOption(PeerSettingsPool);
const decodeWebhook = Schema.decodeUnknownOption(PeerSettingsWebhook);

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
    currency: typeof document.currency === "string" ? document.currency : undefined,
    people: entriesOf(document.people, decodePerson),
    projects: entriesOf(document.projects, decodeProject),
    tools: entriesOf(document.tools, decodeTool),
    pools: entriesOf(document.capacity, decodePool),
    webhooks: entriesOf(document.webhooks, decodeWebhook),
  };
}
