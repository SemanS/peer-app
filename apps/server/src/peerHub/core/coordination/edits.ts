/**
 * Agents on the same project hearing of each other without reading each other's conversations, at
 * an edit.
 *
 * Every agent session reports which files of the project's repository it changed. The hub finds
 * pairs that share a file (overlaps). An agent hears about another only when it is about to touch
 * something that agent changed, and then only a few lines: who, what they work on, and how to tell
 * them. Nothing here stops an edit: the agent reads more (`peer status`) or writes to the room
 * (`peer note`) when it decides to.
 *
 * This module is the pure part: what a tool call edits, and what an agent about to change a file
 * hears from the Hub's verdict. The broker asks the Hub and applies the answer (`overlaps.ts`).
 *
 * @module peerHub/core/coordination/edits
 */
import { run } from "../local.ts";
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
 * The paths of the commits in `git log --no-merges --format=%x00%ct --name-only` output made at or
 * after `sinceMs`: what a shell command committed while it ran. An older commit is work the command
 * only brought in (a pull, a checkout of another branch), not the agent's.
 */
export function committedPaths(log: string, sinceMs: number): string[] {
  const since = Math.floor(sinceMs / 1000);
  const paths = new Set<string>();
  for (const commit of log.split("\0").slice(1)) {
    const [time = "", ...files] = commit.split("\n");
    if (!(Number(time) >= since)) continue;
    for (const file of files) if (file.trim() !== "") paths.add(file);
  }
  return [...paths];
}

/**
 * What `git status` says changed under `root`. It takes no optional locks: jj snapshots a colocated
 * working copy with the index locked, and Peer's read must neither wait on it nor take it from jj.
 */
export function readGitStatus(root: string): Promise<string> {
  return run(
    "git",
    ["--no-optional-locks", "-C", root, "status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { raw: true },
  );
}

/**
 * The paths a shell command committed under `root` on top of `from` since `sinceMs`. Nothing when
 * `from` is no longer an ancestor of HEAD: the history was rewritten (`jj squash`, `jj rebase`, an
 * amend), and the rewritten commits' new dates would blame the command for all their files.
 */
export async function readCommittedSince(
  root: string,
  from: string,
  sinceMs: number,
): Promise<string[]> {
  const kept = await run("git", ["-C", root, "merge-base", "--is-ancestor", from, "HEAD"]).then(
    () => true,
    () => false,
  );
  if (!kept) return [];
  const log = await run(
    "git",
    ["-C", root, "log", "--no-merges", "--format=%x00%ct", "--name-only", `${from}..HEAD`],
    { raw: true },
  ).catch(() => "");
  return committedPaths(log, sinceMs);
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

/** The overlap's short id agents type: enough of it to be unique in practice. */
export const shortId = (overlapId: string) => overlapId.slice(0, 6);

/**
 * What one session remembers about what it was told, so nothing is said twice. Its sets only grow,
 * and the broker keeps them on disk, so a restart does not tell it again (`broker/sessionMemory.ts`).
 */
export interface SessionMemory {
  /** What it heard at an edit or its person approved: contests (`contestKey`) and plugins' asks. */
  readonly acknowledged: Set<string>;
  /** Overlaps it was told about. */
  readonly announced: Set<string>;
  /** Overlaps its people were shown a notification of, by id. */
  readonly notified: Set<string>;
}

export const emptyMemory = (): SessionMemory => ({
  acknowledged: new Set(),
  announced: new Set(),
  notified: new Set(),
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

/**
 * Where another agent works, said once: on another computer its edits reach this one only
 * through git, which an agent cannot tell from the files it sees.
 */
export function whereFrom(me: HubCoordSession, other: HubCoordSession): string {
  return other.environment === me.environment
    ? "on this computer"
    : "on another computer, so its edits reach you only through git";
}

export interface EditAnswer {
  readonly decision?: "deny" | "ask";
  /** Why, for the agent (deny) or the person (ask). */
  readonly reason?: string;
  /** A heads-up the agent reads next to the tool result. */
  readonly context?: string;
  /** One per contested file and other session: what telling the agent settles. */
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

/** The most paths one intent to the hub carries. */
export const INTENT_MAX_PATHS = 50;

/**
 * What the hub's verdict on one file tells the agent, once per contest, worded from the sessions
 * and overlaps it named: a session the view does not have yet (the hub recorded it just now) is
 * described generically. Whatever it says, the agent goes on.
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
  readonly cli: string;
  /** Whether Peer's texts may name `peer note`. */
  readonly note: boolean;
}): EditAnswer {
  const { verdict, me, memory } = input;
  const file = verdict.path;
  if (verdict.verdict === "clear") return noContest();
  const named = input.overlaps.filter((overlap) => verdict.overlaps.includes(overlap.id));
  const others = [
    ...new Set([
      ...verdict.with,
      ...named.flatMap((overlap) => overlap.sessions.filter((id) => id !== me.id)),
    ]),
  ];
  const contests = (others.length === 0 ? [undefined] : others).map((id) => {
    const overlap = id === undefined ? undefined : named.find((o) => o.sessions.includes(id));
    return {
      id,
      other: input.sessions.find((session) => session.id === id),
      overlap,
      key: contestKey(overlap?.id ?? `with:${id ?? "unknown"}`, file),
    };
  });
  const fresh = contests.filter((contest) => !memory.acknowledged.has(contest.key));
  if (fresh.length === 0) return { ...noContest(), with: others };
  const lines = fresh.map(({ other }) => {
    if (other === undefined) return `Another agent on this project is also working on ${file}.`;
    const intent = other.intent === undefined ? "" : ` They said they are: ${other.intent}.`;
    // A claim, or the hub's record of an intent, is not a change yet.
    const did = other.files.some((path) => touches(path, file))
      ? "also changed"
      : "is also about to change";
    return `${describe(other, input.nameOf, input.taskName)}, working ${whereFrom(me, other)}, ${did} ${file}.${intent}`;
  });
  const tell = input.note
    ? ` If your change interacts with theirs, tell them: ${input.cli} note "<what you change and why>".`
    : "";
  return {
    context: `Peer: ${lines.join(" ")}${tell}`,
    keys: fresh.map((contest) => contest.key),
    overlaps: fresh.flatMap((contest) =>
      contest.overlap === undefined ? [] : [contest.overlap.id],
    ),
    with: others,
  };
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
