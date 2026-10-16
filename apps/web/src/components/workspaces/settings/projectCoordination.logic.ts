/**
 * What a project's Coordination page works out of the settings document: the policy its agents
 * follow, its path rules and what may be added to them, and which rule decides for a path. Pure, so
 * the page only draws it. The Hub validates every pattern again (its `coord/rules.rs`; the shared
 * twin is `validatePathPattern`); what is here is the page's wording of the same rules, and the
 * writes an edit makes to a draft.
 */
import {
  effectivePolicy,
  getAt,
  pathRuleFor,
  rankedPathRules,
  repositoryPath,
  validatePathPattern,
  type PathRule,
} from "@t3tools/client-runtime/peer-settings";

type Mapping = Readonly<Record<string, unknown>>;
const isMapping = (value: unknown): value is Mapping =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A write to the draft, at a path below the project's `coordination` node; `undefined` removes the node. */
export interface Edit {
  readonly path: ReadonlyArray<string>;
  readonly value: unknown;
}

export const POLICIES = ["notify", "coordinate", "ask", "exclusive"] as const;
export type Policy = (typeof POLICIES)[number];
export const isPolicy = (value: unknown): value is Policy =>
  typeof value === "string" && (POLICIES as ReadonlyArray<string>).includes(value);

/** The order a rule's policy is chosen from, as the design lists it. */
export const RULE_POLICIES: ReadonlyArray<Policy> = ["exclusive", "coordinate", "ask", "notify"];

/** Each person decides, or one of the policies the project can set. */
export type PolicyChoice = "computer" | Policy;

export const POLICY_CHOICES: ReadonlyArray<{
  readonly value: PolicyChoice;
  readonly title: string;
  readonly description: string;
}> = [
  {
    value: "computer",
    title: "Each person decides",
    description: "Every computer’s own default applies (Settings › This computer).",
  },
  {
    value: "notify",
    title: "notify",
    description: "The agent learns who else is on the file and keeps going.",
  },
  {
    value: "coordinate",
    title: "coordinate",
    description: "The agent waits until it confirms the overlap or leaves a note.",
  },
  {
    value: "ask",
    title: "ask",
    description: "The agent asks its person before it goes on.",
  },
  {
    value: "exclusive",
    title: "exclusive",
    description: "One live session holds the file, like a lock.",
  },
];

export const isPolicyChoice = (value: unknown): value is PolicyChoice =>
  value === "computer" || isPolicy(value);

/** A project's coordination as the document holds it. */
export interface CoordinationSettings {
  /** The project's own policy; undefined where each person decides. A policy this app does not know is kept as it is. */
  readonly policy: string | undefined;
  /** Pattern → policy. */
  readonly paths: Readonly<Record<string, string>>;
}

/** A project's `coordination` node (the draft's slice) as the page reads it; none says nothing. */
export function readCoordination(coordination: unknown): CoordinationSettings {
  const policy = getAt(coordination, ["policy"]);
  const paths = getAt(coordination, ["paths"]);
  return {
    policy: typeof policy === "string" ? policy : undefined,
    paths: isMapping(paths)
      ? Object.fromEntries(
          Object.entries(paths).flatMap(([pattern, rule]) =>
            typeof rule === "string" ? [[pattern, rule] as const] : [],
          ),
        )
      : {},
  };
}

/** What the project's own policy is, as the status of an environment says it (no settings to read). */
export const choiceOf = (policy: string | undefined): PolicyChoice | null =>
  policy === undefined ? "computer" : isPolicy(policy) ? policy : null;

/**
 * Why a policy cannot be chosen; null while it can. Path rules are exceptions to the project's
 * policy, so a project that has them keeps one: the Hub refuses a coordination without a policy.
 */
export function choiceReason(choice: PolicyChoice, rules: number, project: string): string | null {
  return choice === "computer" && rules > 0
    ? `Not while ${project} has path rules: they are exceptions to its policy. Remove them first.`
    : null;
}

/**
 * The write that makes a choice the project's policy: each person decides takes the whole
 * coordination away (a policy is all it holds besides the rules), another policy sets it.
 */
export const choiceEdit = (choice: PolicyChoice): Edit =>
  choice === "computer" ? { path: [], value: undefined } : { path: ["policy"], value: choice };

/** A project has at most this many path rules, each of at most this many characters. */
export const MAX_RULES = 50;
export const MAX_PATTERN_CHARS = 200;

/** The rules most specific first, as the Hub lists them: the first one that matches a path decides it. */
export const rulesOf = (paths: Readonly<Record<string, string>>): ReadonlyArray<PathRule> =>
  rankedPathRules(paths);

const isControl = (char: string) => {
  const code = char.codePointAt(0) ?? 0;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
};

/** A problem with what was typed in the new rule's field: an error stops Add, a warning does not. */
export interface PatternCheck {
  readonly kind: "error" | "warning";
  readonly message: string;
}

/** The Hub's rules for a pattern, in the Hub's order, worded for the field; null for a valid one. */
function patternProblem(glob: string): string | null {
  const chars = [...glob];
  if (chars.length > MAX_PATTERN_CHARS) return `Use at most ${MAX_PATTERN_CHARS} characters.`;
  if (chars.some(isControl)) return "Use no control characters.";
  if (chars.some((char) => "?[]{}!\\:".includes(char))) {
    return "Use only * and **. These aren’t allowed: ? [ ] { } ! \\ :";
  }
  if (glob.startsWith("/") || glob.endsWith("/")) return "Leave out the leading and trailing /.";
  for (const segment of glob.split("/")) {
    if (segment === "") return "Leave out empty segments (//).";
    if (segment === "." || segment === "..") return "Leave out . and .. segments.";
    if (segment !== "**" && segment.includes("**")) {
      return "Use ** as a whole segment, like a/**/b.";
    }
  }
  // What the shared twin of the Hub's check refuses that this does not name: its own words.
  const refused = validatePathPattern(glob);
  return refused === null ? null : `${refused[0]?.toUpperCase() ?? ""}${refused.slice(1)}.`;
}

/**
 * What to say about a rule being typed: nothing while the field is empty; an error for a pattern the
 * Hub would refuse, for one the project already has a rule for, and for a project at its limit; a
 * warning for `**` as exclusive, which the Hub accepts and which locks the whole repository.
 */
export function checkPattern(
  text: string,
  policy: string,
  existing: ReadonlyArray<string>,
): PatternCheck | null {
  const pattern = text.trim();
  if (pattern === "") return null;
  const problem = patternProblem(pattern);
  if (problem !== null) return { kind: "error", message: problem };
  if (existing.includes(pattern)) {
    return { kind: "error", message: `${pattern} already has a rule. Change its policy above.` };
  }
  if (existing.length >= MAX_RULES) {
    return { kind: "error", message: `A project has at most ${MAX_RULES} path rules.` };
  }
  if (pattern === "**" && policy === "exclusive") {
    return {
      kind: "warning",
      message: "With exclusive, ** locks the whole repository for one session at a time.",
    };
  }
  return null;
}

/**
 * Why no rule can be added now, whatever is typed: the project sets no policy for them to be
 * exceptions to, or it has all the rules it may. Null while one can.
 */
export function addRuleBlocker(settings: CoordinationSettings, project: string): string | null {
  if (settings.policy === undefined) {
    return `Pick a policy for ${project} first: path rules are exceptions to it.`;
  }
  return Object.keys(settings.paths).length >= MAX_RULES
    ? `A project has at most ${MAX_RULES} path rules.`
    : null;
}

/** Whether the typed pattern can be added with Add. */
export const canAddRule = (check: PatternCheck | null, text: string): boolean =>
  text.trim() !== "" && check?.kind !== "error";

/** The write that adds a rule, or changes the policy of the one the pattern names. */
export const setRuleEdit = (pattern: string, policy: string): Edit => ({
  path: ["paths", pattern],
  value: policy,
});

/**
 * The write that takes a rule away. The last one takes the whole `paths` node: an empty one would
 * differ from the saved settings, which leave it out.
 */
export const removeRuleEdit = (paths: Readonly<Record<string, string>>, pattern: string): Edit =>
  Object.keys(paths).length <= 1
    ? { path: ["paths"], value: undefined }
    : { path: ["paths", pattern], value: undefined };

/** What decides for a path. */
export type Deciding =
  | { readonly kind: "computer" }
  | {
      readonly kind: "project";
      readonly policy: string;
      /** A rule matches the path but the Hub does not apply rules: the test says so. */
      readonly rulesOff: boolean;
    }
  | { readonly kind: "rule"; readonly policy: string; readonly pattern: string };

/**
 * Which rule decides for a path, by the Hub's order of specificity: the best rule that matches, else
 * the project's policy, else each person's own default. Null while the text is no repository path.
 * Where the Hub applies no path rules (`rulesApply` false) a matching rule changes nothing, and the
 * answer is the project's policy, marked.
 */
export function deciding({
  path,
  settings,
  rulesApply,
}: {
  readonly path: string;
  readonly settings: CoordinationSettings;
  readonly rulesApply: boolean;
}): Deciding | null {
  if (repositoryPath(path) === undefined) return null;
  if (settings.policy === undefined) return { kind: "computer" };
  const rule = pathRuleFor(path, settings.paths);
  if (rule !== undefined && rulesApply) {
    return { kind: "rule", policy: rule.policy, pattern: rule.pattern };
  }
  return { kind: "project", policy: settings.policy, rulesOff: rule !== undefined };
}

/**
 * What this computer's agents follow where a project lets each person decide: whether agent
 * coordination runs here at all, and the default policy its agents follow.
 */
export interface ComputerCoordination {
  readonly enabled: boolean;
  readonly policy: string;
}

/** The page where this computer's default policy is set, as the panel names it. */
const COMPUTER_COORDINATION_PAGE = "This computer › Coordination & plugins";

/** What the test cannot say, since each person's own computer decides for them. */
const OTHER_COMPUTERS_NOTE =
  "Everyone else: their own computer’s default — notify, coordinate or ask. Peer doesn’t know their choice.";

/** What a policy does to the agents on the files it covers, as the test says it. */
const POLICY_EFFECT: Readonly<Record<string, string>> = {
  notify: "The agent learns who else is on these files and keeps going.",
  coordinate: "The agent waits until it confirms the overlap or leaves a note.",
  ask: "The agent asks its person before it goes on.",
  exclusive: "One agent at a time edits these files.",
};

/** The answer to "which rule decides?" in the parts the panel draws. */
export interface PathTest {
  /** How the path got its answer, after the arrow: "no path rule → …", or "path rule" and its `pattern`. */
  readonly via: string;
  /** The rule that matched, drawn as code after `via`. */
  readonly pattern: string | null;
  /** Whose mode the box shows. */
  readonly scope: "On this computer" | "For everyone";
  /** The mode: a policy, or "off" where agent coordination is off on this computer. */
  readonly mode: string;
  /** Where the mode comes from, in a sentence. */
  readonly source: string;
  /** The mode is this computer's own, which Change opens the page for. */
  readonly changeable: boolean;
  /** About the computers the test does not see; none where the project decides for everyone. */
  readonly others: string | null;
  /** The Hub keeps a rule that matches from applying: the box is marked. */
  readonly warn: boolean;
}

const forEveryone = (policy: string) => ({
  scope: "For everyone" as const,
  mode: policy,
  source: `${POLICY_EFFECT[policy] === undefined ? "" : `${POLICY_EFFECT[policy]} `}Set by the project.`,
  changeable: false,
  others: null,
});

/**
 * Which rule decides for a path, and the mode that comes of it: the matching rule's policy, else the
 * project's own, both for everyone, else (where the project lets each person decide) this computer's
 * default with the page it is set on, and a line that everyone else's is their own computer's.
 * `effectivePolicy` says which of the project's policy and this computer's default counts. Null
 * while the text is no repository path.
 */
export function pathTest(input: {
  readonly path: string;
  readonly settings: CoordinationSettings;
  readonly rulesApply: boolean;
  readonly project: { readonly id: string; readonly name: string };
  readonly computer: ComputerCoordination;
}): PathTest | null {
  const decision = deciding(input);
  if (decision === null) return null;
  if (decision.kind === "rule") {
    return {
      via: "path rule",
      pattern: decision.pattern,
      ...forEveryone(decision.policy),
      warn: false,
    };
  }
  const { project, computer } = input;
  const counts = effectivePolicy(
    { [project.id]: input.settings.policy },
    project.id,
    computer.policy,
  );
  if (counts.source === "computer") {
    return {
      via: "no path rule → the project lets each person decide",
      pattern: null,
      scope: "On this computer",
      mode: computer.enabled ? counts.value : "off",
      source: computer.enabled
        ? `Your default · set in ${COMPUTER_COORDINATION_PAGE}`
        : `Agent coordination is off on this computer · turn it on in ${COMPUTER_COORDINATION_PAGE}`,
      changeable: true,
      others: OTHER_COMPUTERS_NOTE,
      warn: false,
    };
  }
  const rulesOff = decision.kind === "project" && decision.rulesOff;
  return {
    via: rulesOff
      ? `a path rule matches, but path rules are off on this Hub → ${project.name}’s policy`
      : `no path rule → ${project.name}’s policy`,
    pattern: null,
    ...forEveryone(counts.value),
    warn: rulesOff,
  };
}

/** The count in "Path rules 3 of 50". */
export const rulesCountText = (count: number): string => `${count} of ${MAX_RULES}`;

/** What the page says of a project's rules where it only knows how many there are (no settings). */
export const ruleCountSentence = (count: number, project: string): string =>
  `${project} has ${count} path ${count === 1 ? "rule" : "rules"}.`;
