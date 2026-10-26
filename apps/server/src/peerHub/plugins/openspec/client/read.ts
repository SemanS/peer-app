// @effect-diagnostics nodeBuiltinImport:off - bounded live files in the selected repository.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";
import {
  PeerHubError,
  type PeerOpenSpecReadResult,
  type PeerOpenSpecSnapshot,
  type PeerTask,
} from "@t3tools/contracts";

const isHubError = Schema.is(PeerHubError);

const MAX_FILE_BYTES = 262_144;
const slug = (value: string) =>
  /^[a-z0-9][a-z0-9._-]{0,199}$/i.test(value) && value !== "." && value !== "..";
const missing = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error.code === "ENOENT" || error.code === "ENOTDIR");
const unavailable = (
  reason: string,
  code: "not-linked" | "source-unavailable" = "source-unavailable",
) => ({ state: "unavailable" as const, code, reason });
const fail = (detail: string): never => {
  throw new PeerHubError({ detail });
};
const inside = (root: string, target: string) => {
  const relative = NodePath.relative(root, target);
  if (
    relative === ".." ||
    relative.startsWith(`..${NodePath.sep}`) ||
    NodePath.isAbsolute(relative)
  )
    fail("OpenSpec source resolves outside its repository or change directory.");
};
async function real(root: string, target: string) {
  const resolved = await NodeFSP.realpath(target);
  inside(root, resolved);
  return resolved;
}
async function text(root: string, target: string): Promise<string | null> {
  let path: string;
  try {
    path = await real(root, target);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  const file = await NodeFSP.open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile()) fail("OpenSpec source is not a regular file.");
    if (stat.size > MAX_FILE_BYTES)
      throw new RangeError("OpenSpec source file is too large to display safely.");
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_FILE_BYTES)
      throw new RangeError("OpenSpec source file is too large to display safely.");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
}
function explicitChange(
  raw: string | null,
  task: Pick<PeerTask, "id" | "key">,
): string | null | undefined {
  if (raw === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    parsed.version !== 1 ||
    !("tasks" in parsed) ||
    typeof parsed.tasks !== "object" ||
    parsed.tasks === null ||
    Array.isArray(parsed.tasks)
  )
    return null;
  const handles = new Set(
    [task.id, task.key]
      .filter((value): value is string => value !== undefined)
      .map((value) => value.toLowerCase()),
  );
  const matches = Object.entries(parsed.tasks).filter(([id]) => handles.has(id.toLowerCase()));
  if (!matches.length) return undefined;
  const values = new Set(matches.map(([, value]) => value));
  if (values.size !== 1) return null;
  const [value] = values;
  if (typeof value !== "string" || !slug(value))
    fail("OpenSpec mapping contains an unsafe change directory.");
  return value;
}
function goalSection(proposal: string) {
  return (
    proposal.match(/^##\s+Why[^\n]*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/im)?.[1]?.trim() ??
    proposal.trim()
  );
}
function launchPrompt(
  task: Pick<PeerTask, "id" | "key" | "title">,
  sourcePath: string,
  proposal: string,
  tasks: string,
  design: string | null,
) {
  const open = tasks.split(/\r?\n/).filter((line) => /^\s*[-*+]\s+\[ \]\s+/.test(line));
  const why = goalSection(proposal);
  const goal =
    why.length <= 4_000
      ? why
      : `${why.slice(0, 3_900)}\n[Goal excerpt; read proposal.md for the complete goal.]`;
  const instructions = `Work on ${task.key ?? task.id}: ${task.title}.\nRead ${sourcePath}/proposal.md, ${sourcePath}/tasks.md${design === null ? "" : `, ${sourcePath}/design.md`}, and any specifications under ${sourcePath}/specs/ before changing code. Treat those live repository files as the source of truth.\nImplement the remaining tasks, verify the behavior, and update the OpenSpec checklist only for completed work. Work in your own checkout and coordinate shared changes through Peer.\n\nGoal:\n${goal}\n\n${open.length} open checklist items.`;
  const checklist = `\n${open.length ? open.join("\n") : "Read tasks.md and confirm what remains before starting."}`;
  return instructions.length + checklist.length <= 20_000
    ? instructions + checklist
    : `${instructions}\nRead the full checklist in tasks.md; it is too large to inline in this prompt.`;
}

/** `openspec archive` moves a change to `archive/YYYY-MM-DD-<id>`. */
async function archivedAs(changes: string, changeId: string): Promise<string | undefined> {
  try {
    const entries = await NodeFSP.readdir(NodePath.join(changes, "archive"), {
      withFileTypes: true,
    });
    return entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.toLowerCase().endsWith(`-${changeId.toLowerCase()}`) &&
          /^\d{4}-\d{2}-\d{2}-/.test(entry.name),
      )
      .map((entry) => entry.name)
      .sort()
      .at(-1);
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
}

/** What one repository says of a task's change, for its brief's link state. */
export interface SourceRead {
  /** The live change, or why it cannot be read. */
  readonly live: Extract<PeerOpenSpecReadResult, { state: "ready" | "unavailable" }>;
  /** The change read (or that should have been): the saved link's, the mapping's or the name's. */
  readonly changeId?: string;
  /** What `openspec/peer-tasks.json` maps the task to; null when it is invalid or conflicting. */
  readonly mapped?: string | null;
  /** The one change directory named exactly like the task. */
  readonly named?: string;
  readonly archivedAs?: string;
  /** The change directory is gone: renamed, deleted or archived. */
  readonly gone?: true;
  /** The repository itself is not on this environment. */
  readonly noCheckout?: true;
  readonly snapshot?: PeerOpenSpecSnapshot;
}

const MAX_ITEMS = 200;
const MAX_ITEM = 500;
const MAX_GOAL = 4_000;

/** The proposal's Why section, as a brief keeps it. */
function goalOf(proposal: string) {
  const why = goalSection(proposal);
  return why.length <= MAX_GOAL ? why : `${why.slice(0, MAX_GOAL - 1).trimEnd()}…`;
}

/** The change as a brief would hold it; the fingerprint covers exactly what the brief is taken from. */
export function snapshotOf(proposal: string, tasks: string): PeerOpenSpecSnapshot {
  const checklist = [...tasks.matchAll(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/gm)]
    .slice(0, MAX_ITEMS)
    .map((match) => {
      const text = (match[2] ?? "").trim();
      return {
        text: text.length <= MAX_ITEM ? text : `${text.slice(0, MAX_ITEM - 1)}…`,
        done: match[1] !== " ",
      };
    });
  const fingerprint = NodeCrypto.createHash("sha256")
    .update(proposal)
    .update("\0")
    .update(tasks)
    .digest("hex");
  return { goal: goalOf(proposal), checklist, fingerprint };
}

/**
 * A saved link wins, then the repository mapping, then a change named exactly like the task id or
 * key, ignoring case. The mapping and the name are reported either way, so a caller sees a
 * repository that disagrees with the saved link.
 */
export async function readSource(
  checkout: string,
  repositoryId: string,
  task: Pick<PeerTask, "id" | "key" | "title">,
  saved?: string,
): Promise<SourceRead> {
  try {
    let root: string;
    try {
      root = await NodeFSP.realpath(checkout);
    } catch (error) {
      if (missing(error))
        return {
          live: unavailable("The project repository is not available on this environment."),
          noCheckout: true,
          ...(saved === undefined ? {} : { changeId: saved }),
        };
      throw error;
    }
    let mapped: string | null | undefined;
    try {
      mapped = explicitChange(
        await text(root, NodePath.join(root, "openspec/peer-tasks.json")),
        task,
      );
    } catch (error) {
      if (saved === undefined || !isHubError(error)) throw error;
      mapped = null;
    }
    const known = mapped === undefined ? {} : { mapped };
    if (mapped === null && saved === undefined)
      return {
        ...known,
        live: unavailable(
          "openspec/peer-tasks.json is invalid or maps this task to more than one change. Fix that file in the repository, then retry.",
        ),
      };
    let changes: string;
    try {
      changes = await real(root, NodePath.join(root, "openspec/changes"));
    } catch (error) {
      if (!missing(error)) throw error;
      const changeId = saved ?? mapped ?? undefined;
      return {
        ...known,
        ...(changeId === undefined ? {} : { changeId, gone: true as const }),
        live: unavailable(
          "This repository has no OpenSpec changes.",
          changeId === undefined ? "not-linked" : "source-unavailable",
        ),
      };
    }
    const handles = new Set(
      [task.id, task.key]
        .filter((value): value is string => value !== undefined)
        .map((value) => value.toLowerCase()),
    );
    const matches = (await NodeFSP.readdir(changes, { withFileTypes: true })).filter(
      (entry) =>
        (entry.isDirectory() || entry.isSymbolicLink()) && handles.has(entry.name.toLowerCase()),
    );
    const named = matches.length === 1 ? matches[0]!.name : undefined;
    const seen = { ...known, ...(named === undefined ? {} : { named }) };
    if (saved === undefined && mapped === undefined && matches.length > 1)
      return {
        ...seen,
        live: unavailable(
          "This task matches multiple OpenSpec changes. Map it to one of them in openspec/peer-tasks.json, then retry.",
        ),
      };
    const changeId = saved ?? mapped ?? named;
    if (changeId === undefined)
      return {
        ...seen,
        live: unavailable(
          "This task is not linked to an OpenSpec change. Map it in openspec/peer-tasks.json or name a change directory after its ID or key.",
          "not-linked",
        ),
      };
    if (!slug(changeId)) fail("OpenSpec change has an unsafe directory name.");
    const by =
      saved === undefined ? "openspec/peer-tasks.json maps this task to" : "This task is linked to";
    let change: string;
    try {
      change = await real(changes, NodePath.join(changes, changeId));
    } catch (error) {
      if (!missing(error)) throw error;
      const archived = await archivedAs(changes, changeId);
      return {
        ...seen,
        changeId,
        gone: true,
        ...(archived === undefined ? {} : { archivedAs: archived }),
        live: unavailable(
          archived === undefined
            ? `${by} ${changeId}, which no longer exists in openspec/changes. ${saved === undefined ? "Point the entry at the current change or remove it, then retry." : "Link another change, or keep the brief as the task's own."}`
            : `${by} ${changeId}, which was archived as openspec/changes/archive/${archived}. Close the task if its work is done, or link a current change.`,
        ),
      };
    }
    const proposal = await text(change, NodePath.join(change, "proposal.md"));
    const tasks = await text(change, NodePath.join(change, "tasks.md"));
    const design = await text(change, NodePath.join(change, "design.md"));
    if (proposal === null || tasks === null)
      return {
        ...seen,
        changeId,
        live: unavailable(
          `openspec/changes/${changeId} needs proposal.md and tasks.md before Peer can brief an agent.`,
        ),
      };
    const checks = [...tasks.matchAll(/^\s*[-*+]\s+\[([ xX])\]\s+/gm)];
    const sourcePath = `openspec/changes/${changeId}`;
    return {
      ...seen,
      changeId,
      snapshot: snapshotOf(proposal, tasks),
      live: {
        state: "ready",
        repositoryId,
        changeId,
        sourcePath,
        proposal,
        tasks,
        design,
        prompt: launchPrompt(task, sourcePath, proposal, tasks, design),
        completed: checks.filter((match) => match[1]?.toLowerCase() === "x").length,
        total: checks.length,
      },
    };
  } catch (error) {
    if (error instanceof RangeError) return { live: unavailable(error.message) };
    if (isHubError(error)) throw error;
    throw new PeerHubError({
      detail: "Could not read the OpenSpec source files on this environment.",
    });
  }
}

/** The live change alone, as a task without a brief reads it. */
export async function readTaskSource(
  checkout: string,
  repositoryId: string,
  task: Pick<PeerTask, "id" | "key" | "title">,
): Promise<PeerOpenSpecReadResult> {
  return (await readSource(checkout, repositoryId, task)).live;
}

/** The repository's current changes (not the archive), each with its proposal's first heading. */
export async function listChanges(
  checkout: string,
): Promise<ReadonlyArray<{ readonly name: string; readonly title: string }>> {
  let changes: string;
  try {
    const root = await NodeFSP.realpath(checkout);
    changes = await real(root, NodePath.join(root, "openspec/changes"));
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
  const found = [];
  for (const entry of await NodeFSP.readdir(changes, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "archive" || !slug(entry.name)) continue;
    const dir = NodePath.join(changes, entry.name);
    const proposal = await text(dir, NodePath.join(dir, "proposal.md")).catch(() => null);
    if (proposal === null) continue;
    const heading = proposal.match(/^#\s+(.+)$/m)?.[1]?.trim();
    found.push({
      name: entry.name,
      title: heading === undefined || /^proposal$/i.test(heading) ? entry.name : heading,
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}
