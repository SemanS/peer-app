/**
 * Agents on the same project staying out of each other's way without reading each other's
 * conversations, at an edit.
 *
 * Every agent session reports which files of the project's repository it changed. The hub finds
 * pairs that share a file (overlaps) and keeps one short thread of notes per overlap. An agent hears
 * about another only when it is about to touch something that agent changed, and then only a few
 * lines: who, what they work on, their latest note, and how to answer. It reads more (`peer status`)
 * or writes a note (`peer note`) when it decides to. People see the same overlaps and notes in Peer.
 *
 * This module is the pure part: what a tool call edits, and what an agent about to change a file
 * hears, from the view or from the Hub's verdict, and when the Hub gave none. The broker asks the
 * Hub and applies the answer (`overlaps.ts`).
 *
 * @module peerHub/core/coordination/edits
 */
import type { PeerCoordinationPolicy, PeerProjectPolicy } from "@t3tools/contracts";

import { neutral, plain } from "../../peerText.ts";
import type { HubCoordSession, HubIntentVerdict, HubOverlap } from "../hub/coordApi.ts";

/** The agents Peer coordinates, each through the hooks its harness runs. */
export type AgentKind = "claude" | "codex";

/** How people name each agent. */
export const AGENT_NAMES: Readonly<Record<AgentKind, string>> = {
  claude: "Claude Code",
  codex: "Codex",
};

/** The agent a hook came from, as Peer's hook script says: Claude Code when it says nothing. */
export function agentNamed(value: string | undefined): AgentKind {
  return value === "codex" ? "codex" : "claude";
}

/** Claude Code tools that change a file. */
export const EDIT_TOOLS: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
]);

/** The file an editing tool call changes, as the agent named it. */
export function editedFile(toolName: unknown, toolInput: unknown): string | null {
  if (typeof toolName !== "string" || !EDIT_TOOLS.has(toolName)) return null;
  if (typeof toolInput !== "object" || toolInput === null) return null;
  const input = toolInput as Record<string, unknown>;
  const path = input.file_path ?? input.notebook_path;
  return typeof path === "string" && path !== "" ? path : null;
}

/**
 * The files a Codex `apply_patch` changes, as the patch names them: added,
 * updated, deleted, and the new name of a moved file.
 */
export function patchPaths(patch: string): string[] {
  const paths: string[] = [];
  for (const match of patch.matchAll(
    /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm,
  )) {
    const path = (match[1] ?? "").trim();
    if (path !== "" && !paths.includes(path)) paths.push(path);
  }
  return paths;
}

/**
 * The files a tool call edits, as the agent named them: Claude Code's editing
 * tools name one, absolute; a Codex patch names any number, relative to the
 * session's working directory.
 */
export function editedFiles(toolName: unknown, toolInput: unknown): string[] {
  const one = editedFile(toolName, toolInput);
  if (one !== null) return [one];
  if (toolName !== "apply_patch" || typeof toolInput !== "object" || toolInput === null) return [];
  const patch = (toolInput as Record<string, unknown>).command;
  return typeof patch === "string" ? patchPaths(patch) : [];
}

/** A path relative to the repository at `root`, or null when it lies outside. */
export function repositoryPath(root: string, path: string): string | null {
  const base = root.endsWith("/") ? root : `${root}/`;
  if (!path.startsWith(base)) return null;
  const relative = path.slice(base.length);
  return relative === "" || relative.split("/").includes("..") ? null : relative;
}

/** The paths `git status --porcelain -z` reports changed, the new name of a rename. */
export function changedPaths(porcelain: string): string[] {
  const fields = porcelain.split("\0");
  const paths: string[] = [];
  for (let at = 0; at < fields.length; at += 1) {
    const field = fields[at] ?? "";
    if (field.length < 4) continue;
    paths.push(field.slice(3));
    // A rename or copy carries its old name in the next field.
    if (/[RC]/.test(field.slice(0, 2))) at += 1;
  }
  return paths;
}

/**
 * Files two agents each change without anything to agree on: a lockfile is made again after the
 * merge, `.DS_Store` is nobody's work. The hub leaves them out of overlaps too.
 */
const GENERATED_FILES: ReadonlySet<string> = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "go.sum",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "composer.lock",
  "Gemfile.lock",
  "flake.lock",
  ".DS_Store",
]);

export const generatedFile = (path: string) => GENERATED_FILES.has(path.split("/").at(-1) ?? path);

/** Two paths name the same thing, or one is a claimed directory holding the other. */
export function touches(a: string, b: string): boolean {
  return a === b || (a.endsWith("/") && b.startsWith(a)) || (b.endsWith("/") && a.startsWith(b));
}

/** What a session changed or claimed. */
function pathsOf(session: HubCoordSession): ReadonlyArray<string> {
  return [...session.files, ...session.claims];
}

/** The overlap's short id agents type: enough of it to be unique in practice. */
export const shortId = (overlapId: string) => overlapId.slice(0, 6);

/**
 * What one session remembers about what it was told, so nothing is said twice. Its sets only grow,
 * and the broker keeps them on disk, so a restart does not tell it again (`broker/sessionMemory.ts`).
 */
export interface SessionMemory {
  /** Overlaps (by id, or `with:<session>` before the hub named one) it answered or its person approved. */
  readonly acknowledged: Set<string>;
  /** Notes it was shown. */
  readonly seenNotes: Set<string>;
  /** Overlaps it was told about. */
  readonly announced: Set<string>;
  /** Quiet overlaps it was asked to close, as `<overlap id>:<how many notes it had>`. */
  readonly settled: Set<string>;
}

export const emptyMemory = (): SessionMemory => ({
  acknowledged: new Set(),
  seenNotes: new Set(),
  announced: new Set(),
  settled: new Set(),
});

export interface CoordinationView {
  readonly sessions: ReadonlyArray<HubCoordSession>;
  readonly overlaps: ReadonlyArray<HubOverlap>;
}

/** The person behind an email, as the workspace names them. */
export type NameOf = (email: string) => string;

/** A task as people name it, e.g. `KRK-335 · DNS errors`, from its id. */
export type TaskNamer = (task: string) => string;

const TRUNKS: ReadonlySet<string> = new Set(["main", "master", "trunk", "develop"]);

/**
 * How a session is described to another agent: whose, on which task, doing
 * what, where. The task tells agents apart better than a terminal's title or
 * a first prompt does.
 */
export function describe(session: HubCoordSession, nameOf: NameOf, taskName?: TaskNamer): string {
  // Everyone is on the trunk most of the time; only another branch says something.
  const branch =
    session.branch === undefined || TRUNKS.has(session.branch)
      ? undefined
      : `branch ${session.branch}`;
  const agent =
    session.agent === undefined
      ? undefined
      : (AGENT_NAMES[session.agent as AgentKind] ?? session.agent);
  const task =
    session.task === undefined ? undefined : `on ${taskName?.(session.task) ?? session.task}`;
  const details = [agent, task, `"${session.label}"`, branch].filter(
    (part): part is string => part !== undefined && part !== "",
  );
  return `${nameOf(session.email)}'s agent (${details.join(", ")})`;
}

/** A claim on a task (`peer ask`): talking with the agents at work on it, not changing files. */
export const taskClaim = (task: string) => `task:${task}`;

/** The task a claim or an overlap's path names, when it is a task claim. */
export function claimedTask(path: string): string | undefined {
  return path.startsWith("task:") && path.length > "task:".length
    ? path.slice("task:".length)
    : undefined;
}

/** What an overlap is about, as agents and people read it: the files, or the task asked about. */
export function overlapSubject(files: ReadonlyArray<string>, taskName: TaskNamer): string {
  const asked = files.flatMap((path) => {
    const task = claimedTask(path);
    return task === undefined ? [] : [taskName(task)];
  });
  const resources = files
    .filter((path) => path.startsWith("resource:"))
    .map((path) => `resource ${path.slice(9)}`);
  const patterns = files
    .filter((path) => path.startsWith("pattern:"))
    .map((path) => `pattern ${path.slice(8)}`);
  const paths = files.filter(
    (path) =>
      claimedTask(path) === undefined &&
      !path.startsWith("resource:") &&
      !path.startsWith("pattern:"),
  );
  return [
    ...(asked.length === 0 ? [] : [`a question about ${asked.join(", ")}`]),
    ...resources,
    ...patterns,
    ...(paths.length === 0 ? [] : [paths.join(", ")]),
  ].join(" and ");
}

/**
 * Where another agent works, said once: on another computer its edits reach this one only
 * through git, which an agent cannot tell from the files it sees.
 */
export function whereFrom(me: HubCoordSession, other: HubCoordSession): string {
  return other.environment === me.environment
    ? "on this computer"
    : "on another computer, so its edits reach you only through git";
}

const between = (overlap: HubOverlap, me: string, other: string) =>
  overlap.sessions.includes(me) && overlap.sessions.includes(other);

/** The newest note on an overlap written by anyone but `me`. */
function latestOtherNote(overlap: HubOverlap | undefined, me: string) {
  return overlap?.notes.findLast((note) => note.session !== me);
}

export interface EditAnswer {
  readonly decision?: "deny" | "ask";
  /** Why, for the agent (deny) or the person (ask). */
  readonly reason?: string;
  /** A heads-up the agent reads next to the tool result. */
  readonly context?: string;
  /** One per contested file and other session: what an answer (note, approval) settles. */
  readonly keys: ReadonlyArray<string>;
  /** The overlaps the hub already knows that this answer was about. */
  readonly overlaps: ReadonlyArray<string>;
  /** The sessions the file is contested with. */
  readonly with: ReadonlyArray<string>;
}

/** An answer that says nothing: no contest, or none left to tell of. */
export const noContest = (): EditAnswer => ({ keys: [], overlaps: [], with: [] });

/** What settles a contest over one file with one other session, before or after the hub named it. */
export const contestKey = (overlapOrSession: string, file: string) => `${overlapOrSession}#${file}`;

/** An overlap is news again when files join it. */
export const announcementKey = (overlap: HubOverlap) => `${overlap.id}:${overlap.files.length}`;

/** A file contested with another session: what an answer about it is worded from. */
export interface Contest {
  /** The other session; none when the hub said the file is contested without saying with whom. */
  readonly otherId: string | undefined;
  /** Its session when this computer has it in view: the hub may name one it has not heard of yet. */
  readonly other: HubCoordSession | undefined;
  readonly overlap: HubOverlap | undefined;
  /** What settles it (`contestKey`). */
  readonly key: string;
}

/**
 * What to tell a session about to change `file`: nothing when nobody else at
 * work on the project changed or claimed it; otherwise, by policy, a
 * heads-up, a request to write the other agent a note first, or a question
 * for its person — once per overlap, until something new happens.
 */
export function decideEdit(input: {
  readonly policy: PeerCoordinationPolicy;
  readonly me: HubCoordSession;
  readonly file: string;
  readonly view: CoordinationView;
  readonly memory: SessionMemory;
  readonly nameOf: NameOf;
  readonly taskName?: TaskNamer;
  readonly cli: string;
}): EditAnswer {
  const { me, file, view } = input;
  if (generatedFile(file)) return noContest();
  const others = view.sessions.filter(
    (session) =>
      session.id !== me.id &&
      session.project === me.project &&
      pathsOf(session).some((path) => touches(path, file)),
  );
  const contests = others.flatMap((other): Contest[] => {
    const overlap = view.overlaps.find(
      (o) => o.project === me.project && between(o, me.id, other.id),
    );
    // An agreement that covered this file settles it.
    if (overlap?.state === "resolved" && overlap.resolvedFiles?.includes(file)) return [];
    return [
      {
        otherId: other.id,
        other,
        overlap,
        key: contestKey(overlap?.id ?? `with:${other.id}`, file),
      },
    ];
  });
  return composeEditAnswer({ ...input, contests });
}

/**
 * The words for an edit of `file` that is contested, by policy: a heads-up, a request to write
 * the other agent a note first, or a question for the person. A contest the session already
 * answered (`memory`) is not said again. The contests come from the view (`decideEdit`) or from
 * what the hub decided (`answerForVerdict`).
 */
function composeEditAnswer(input: {
  readonly policy: PeerCoordinationPolicy;
  readonly me: HubCoordSession;
  readonly file: string;
  readonly contests: ReadonlyArray<Contest>;
  readonly memory: SessionMemory;
  readonly nameOf: NameOf;
  readonly taskName?: TaskNamer;
  readonly cli: string;
}): EditAnswer {
  const { me, file, contests, memory } = input;
  if (contests.length === 0) return noContest();
  const contested = contests.flatMap((c) => (c.otherId === undefined ? [] : [c.otherId]));
  const fresh = contests.filter((contest) => !memory.acknowledged.has(contest.key));
  if (fresh.length === 0) return { keys: [], overlaps: [], with: contested };

  const lines = fresh.map(({ other, overlap }) => {
    const note = latestOtherNote(overlap, me.id);
    const said = note === undefined ? "" : ` Their note: "${neutral(note.text)}"`;
    const id = overlap === undefined ? "" : ` [overlap ${shortId(overlap.id)}]`;
    // The hub named a session this computer has not heard of yet: all it can say is that it is there.
    if (other === undefined) {
      return `Another agent on this project is also working on ${file}.${said}${id}`;
    }
    const intent = other.intent === undefined ? "" : ` They said they are: ${other.intent}.`;
    // A claim, or the hub's record of an intent, is not a change yet.
    const did = other.files.some((path) => touches(path, file))
      ? "also changed"
      : "is also about to change";
    return `${describe(other, input.nameOf, input.taskName)}, working ${whereFrom(me, other)}, ${did} ${file}.${intent}${said}${id}`;
  });
  const heading = `Peer: ${lines.join(" ")}`;
  const keys = fresh.map((contest) => contest.key);
  const overlaps = fresh.flatMap((contest) =>
    contest.overlap === undefined ? [] : [contest.overlap.id],
  );
  switch (input.policy) {
    case "notify":
      return {
        context: `${heading} If your change interacts with theirs, tell them: ${input.cli} note "<what you change and why>".`,
        keys,
        overlaps,
        with: contested,
      };
    case "ask":
      return { decision: "ask", reason: heading, keys, overlaps, with: contested };
    case "coordinate":
      return {
        decision: "deny",
        reason: `${heading} Peer coordinates the agents on this project: before editing ${file}, tell them your plan with ${input.cli} note "<your plan for ${file}>" — it only posts a short note both agents and their people see, and changes no files. Then edit if the plans fit; if they clash, propose a split in the note and check replies with ${input.cli} status.`,
        keys,
        overlaps,
        with: contested,
      };
  }
}

// ---- the hub decides an edit ----

/** The most paths one intent to the hub carries. */
export const INTENT_MAX_PATHS = 50;

const PROJECT_POLICIES: ReadonlySet<string> = new Set(["notify", "coordinate", "ask", "exclusive"]);

const isProjectPolicy = (value: string): value is PeerProjectPolicy => PROJECT_POLICIES.has(value);

/**
 * The policy that holds while the hub gives no verdict: the project's own when this computer
 * heard it with the last view, else the person's Settings. A policy this Peer does not know
 * (a newer hub's) counts as none.
 */
export function policyWithoutHub(
  policies: Readonly<Record<string, string>> | undefined,
  project: string,
  settings: PeerCoordinationPolicy,
): PeerProjectPolicy {
  const named = policies?.[project];
  return named !== undefined && isProjectPolicy(named) ? named : settings;
}

/**
 * The policy that decided an overlap: what the project decided (its policy, or the path rule the
 * hub recorded) where the hub says so, else `fallback`. A project decides for every computer, but
 * a `client` decision is the default of the computer that asked, which may be another one: it
 * never replaces this computer's own. A policy this Peer does not know (a newer hub's) counts as
 * none, as in `policyWithoutHub`.
 */
export function policyOfDecision(
  decision: { readonly policy: string; readonly source: "project" | "client" } | undefined,
  fallback: PeerProjectPolicy,
): PeerProjectPolicy {
  return decision?.source === "project" && isProjectPolicy(decision.policy)
    ? decision.policy
    : fallback;
}

/** The policies projects set themselves that this Peer applies, by project: those it does not know are left out. */
export function knownPolicies(
  policies: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, PeerProjectPolicy>> {
  return Object.fromEntries(
    Object.entries(policies ?? {})
      .filter((entry): entry is [string, PeerProjectPolicy] => isProjectPolicy(entry[1]))
      .toSorted(([a], [b]) => a.localeCompare(b)),
  );
}

/**
 * What the hub's verdict on one file tells the agent. The hub decided; this words it from the
 * sessions and overlaps it named, as `decideEdit` words what it finds in the view: a session the
 * view does not have yet (the hub recorded it just now) is described generically. What this
 * computer remembers of having told the agent counts for a heads-up and a question to its person,
 * not for a denial: that is the hub's to lift, with an acknowledgement.
 */
export function answerForVerdict(input: {
  readonly verdict: HubIntentVerdict;
  readonly me: HubCoordSession;
  readonly sessions: ReadonlyArray<HubCoordSession>;
  /** The overlaps the hub sent with its answer. */
  readonly overlaps: ReadonlyArray<HubOverlap>;
  readonly memory: SessionMemory;
  readonly nameOf: NameOf;
  readonly taskName?: TaskNamer;
  /** Hub clock accompanying a leased hold. */
  readonly at?: string;
  readonly cli: string;
}): EditAnswer {
  const { verdict, me } = input;
  const file = verdict.pattern === undefined ? verdict.path : `pattern ${verdict.pattern}`;
  const lease = verdict.hold;
  const expiry = lease?.expiresAt;
  const left =
    expiry === undefined || input.at === undefined
      ? ""
      : ` (${Math.max(0, Math.ceil((Date.parse(expiry) - Date.parse(input.at)) / 60_000))} min left)`;
  const until = expiry === undefined ? "" : ` until ${expiry}${left}`;
  if (verdict.verdict === "clear") {
    if (verdict.pattern === undefined || lease?.session !== me.id) return noContest();
    const key = `hold:${verdict.pattern}:${me.id}`;
    if (input.memory.announced.has(key)) return noContest();
    input.memory.announced.add(key);
    return {
      ...noContest(),
      context: `Peer: you hold ${file}${until}. Release it when finished: ${input.cli} release "${verdict.pattern}".`,
    };
  }
  const named = input.overlaps.filter((overlap) => verdict.overlaps.includes(overlap.id));
  const others = [
    ...new Set([
      ...verdict.with,
      ...named.flatMap((overlap) => overlap.sessions.filter((id) => id !== me.id)),
    ]),
  ];
  const contests: Contest[] = others.map((id) => {
    const overlap = named.find((o) => between(o, me.id, id));
    return {
      otherId: id,
      other: input.sessions.find((session) => session.id === id),
      overlap,
      key: contestKey(overlap?.id ?? `with:${id}`, file),
    };
  });
  // The hub said the file is contested, not with whom: contested all the same.
  if (contests.length === 0) {
    contests.push({
      otherId: undefined,
      other: undefined,
      overlap: undefined,
      key: contestKey("with:unknown", file),
    });
  }
  const words = {
    me,
    file,
    contests,
    nameOf: input.nameOf,
    ...(input.taskName === undefined ? {} : { taskName: input.taskName }),
    cli: input.cli,
  };
  switch (verdict.verdict) {
    case "notify":
      return composeEditAnswer({ ...words, policy: "notify", memory: input.memory });
    case "ask":
      return composeEditAnswer({ ...words, policy: "ask", memory: input.memory });
    case "deny":
      return composeEditAnswer({ ...words, policy: "coordinate", memory: emptyMemory() });
    case "held": {
      const holderId = lease?.session ?? verdict.holder ?? verdict.with[0];
      const holder = input.sessions.find((session) => session.id === holderId);
      const who =
        holder === undefined
          ? lease === undefined
            ? "Another agent on this project"
            : `${plain(input.nameOf(lease.email), 60)}'s agent`
          : describe(holder, input.nameOf, input.taskName);
      return {
        decision: "deny",
        reason: `Peer: ${who} holds ${file} in this project${until}${lease?.intent ? `, for "${plain(lease.intent, 200)}"` : ""}, which lets one agent at a time change a file. Wait until it is done with it, or write it a note asking for it: ${input.cli} note "<why you need ${file}>".`,
        keys: [],
        overlaps: verdict.overlaps,
        with: verdict.with,
      };
    }
  }
}

/**
 * What an edit of `files` hears when the hub gave no verdict in time, by the policy that holds
 * without it: `coordinate` and `exclusive` stop it, to try again in a moment; `ask` leaves it to
 * the person, once for the files not asked about yet (a Codex agent asks, and its next try passes:
 * `memory` has them once asked); `notify` lets it through, and its files reach the next report,
 * where the hub finds the overlaps afterwards.
 */
export function unverifiedAnswer(input: {
  readonly policy: PeerProjectPolicy;
  readonly files: ReadonlyArray<string>;
  readonly memory: SessionMemory;
}): EditAnswer {
  switch (input.policy) {
    case "notify":
      return noContest();
    case "ask": {
      const unasked = input.files.filter(
        (file) => !input.memory.acknowledged.has(contestKey("unconfirmed", file)),
      );
      const [first] = unasked;
      if (first === undefined) return noContest();
      const more = unasked.length > 1 ? ` (and ${unasked.length - 1} more)` : "";
      return {
        decision: "ask",
        reason: `Peer could not confirm this edit with your team's hub: another agent may be changing ${first}${more} too.`,
        keys: unasked.map((file) => contestKey("unconfirmed", file)),
        overlaps: [],
        with: [],
      };
    }
    case "coordinate":
    case "exclusive":
      return {
        decision: "deny",
        reason:
          "Peer could not confirm this edit with your team's hub, so it did not run. Try again in a moment. If the hub stays unreachable, your person can switch this project to notify.",
        keys: [],
        overlaps: [],
        with: [],
      };
  }
}

/**
 * The hook's answer for an edit, from what each of its files said: a denial wins; a question for
 * the person goes to Claude Code's permission prompt, and Codex, which cannot ask before a tool
 * runs, has its agent ask (`acknowledge`: its next try passes); heads-ups go next to the result.
 * Null when nothing was said.
 */
export function editHookAnswer(
  agent: string,
  answers: ReadonlyArray<EditAnswer>,
): {
  readonly output: Record<string, unknown>;
  readonly acknowledge: ReadonlyArray<string>;
} | null {
  const said = answers.filter(
    (answer) => answer.decision !== undefined || answer.context !== undefined,
  );
  if (said.length === 0) return null;
  const deny = said.find((answer) => answer.decision === "deny");
  const ask = said.find((answer) => answer.decision === "ask");
  if (deny !== undefined || (ask !== undefined && agent === "codex")) {
    const reason =
      deny?.reason ??
      `${ask?.reason ?? ""} Ask your person in your reply before you change it, and change it once they agree.`;
    return {
      output: {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason.trim(),
        },
      },
      acknowledge: deny === undefined ? (ask?.keys ?? []) : [],
    };
  }
  if (ask !== undefined) {
    return {
      output: {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: ask.reason,
        },
      },
      acknowledge: [],
    };
  }
  return {
    output: {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: said
          .flatMap((a) => (a.context === undefined ? [] : [a.context]))
          .join("\n\n"),
      },
    },
    acknowledge: [],
  };
}

/** A command without the trim agents like to add to what it prints (`2>&1 | head -30`). */
export function withoutOutputTrim(command: string): string {
  return command.trim().replace(/\s*2>&1\s*(\|\s*(head|tail)(\s+-n)?\s+-?\d+)?$/, "");
}

/** A command that runs Peer's CLI and nothing else, so it may run without asking. */
export function isPlainCliCall(command: string, cli: string): boolean {
  // Agents like to trim what a command prints; that much may follow.
  const trimmed = withoutOutputTrim(command);
  if (!trimmed.startsWith(`${cli} `) && trimmed !== cli) return false;
  const rest = trimmed.slice(cli.length);
  // Words, and quoted text without anything a shell would expand or chain.
  return /^(\s+([A-Za-z0-9._/:@+=,-]+|'[^'\n]*'|"[^"$`\\\n]*"))*\s*$/.test(rest);
}

/** Whether a shell command runs `peer` anywhere in it, plain or not. */
export function mentionsCli(command: string, cli: string): boolean {
  const escaped = cli.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`(^|[;&|(]\\s*|\\s)${escaped}(\\s|$)`).test(command.trim());
}
