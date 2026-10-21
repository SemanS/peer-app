// @effect-diagnostics nodeBuiltinImport:off - bounded live files in the selected repository.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";
import { PeerHubError, type PeerOpenSpecReadResult, type PeerTask } from "@t3tools/contracts";

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
): PeerOpenSpecReadResult => ({ state: "unavailable", code, reason });
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
function launchPrompt(
  task: Pick<PeerTask, "id" | "key" | "title">,
  sourcePath: string,
  proposal: string,
  tasks: string,
  design: string | null,
) {
  const open = tasks.split(/\r?\n/).filter((line) => /^\s*[-*+]\s+\[ \]\s+/.test(line));
  const why =
    proposal.match(/^##\s+Why[^\n]*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/im)?.[1]?.trim() ??
    proposal.trim();
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

/** Repository mapping wins; absent mappings accept exact case-insensitive task id/key only. */
export async function readTaskSource(
  checkout: string,
  repositoryId: string,
  task: Pick<PeerTask, "id" | "key" | "title">,
): Promise<PeerOpenSpecReadResult> {
  try {
    let root: string;
    try {
      root = await NodeFSP.realpath(checkout);
    } catch (error) {
      if (missing(error))
        return unavailable("The project repository is not available on this environment.");
      throw error;
    }
    const mapping = explicitChange(
      await text(root, NodePath.join(root, "openspec/peer-tasks.json")),
      task,
    );
    if (mapping === null)
      return unavailable("The OpenSpec task mapping is invalid or conflicting.");
    let changes: string;
    try {
      changes = await real(root, NodePath.join(root, "openspec/changes"));
    } catch (error) {
      if (missing(error))
        return unavailable(
          "This repository has no OpenSpec changes.",
          mapping === undefined ? "not-linked" : "source-unavailable",
        );
      throw error;
    }
    let changeId = mapping;
    if (changeId === undefined) {
      const handles = new Set(
        [task.id, task.key]
          .filter((value): value is string => value !== undefined)
          .map((value) => value.toLowerCase()),
      );
      const matches = (await NodeFSP.readdir(changes, { withFileTypes: true })).filter(
        (entry) =>
          (entry.isDirectory() || entry.isSymbolicLink()) && handles.has(entry.name.toLowerCase()),
      );
      if (matches.length > 1)
        return unavailable("This task matches multiple OpenSpec changes. Add an explicit mapping.");
      changeId = matches[0]?.name;
    }
    if (changeId === undefined)
      return unavailable("This task is not linked to an OpenSpec change.", "not-linked");
    if (!slug(changeId)) fail("OpenSpec change has an unsafe directory name.");
    let change: string;
    try {
      change = await real(changes, NodePath.join(changes, changeId));
    } catch (error) {
      if (missing(error)) return unavailable("The mapped OpenSpec change no longer exists.");
      throw error;
    }
    const proposal = await text(change, NodePath.join(change, "proposal.md"));
    const tasks = await text(change, NodePath.join(change, "tasks.md"));
    const design = await text(change, NodePath.join(change, "design.md"));
    if (proposal === null || tasks === null)
      return unavailable("This OpenSpec change needs proposal.md and tasks.md.");
    const checks = [...tasks.matchAll(/^\s*[-*+]\s+\[([ xX])\]\s+/gm)];
    const sourcePath = `openspec/changes/${changeId}`;
    return {
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
    };
  } catch (error) {
    if (error instanceof RangeError) return unavailable(error.message);
    if (isHubError(error)) throw error;
    throw new PeerHubError({
      detail: "Could not read the OpenSpec source files on this environment.",
    });
  }
}
