// @effect-diagnostics nodeBuiltinImport:off - isolated repository fixtures.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, expect, it } from "@effect/vitest";
import { listChanges, readSource, readTaskSource, snapshotOf } from "./read.ts";

const roots: string[] = [];
const task = { id: "story-task", key: "VL36", title: "Story summaries" };
async function repository(change = "add-story-summaries") {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-openspec-"));
  roots.push(root);
  const dir = NodePath.join(root, "openspec/changes", change);
  await NodeFSP.mkdir(dir, { recursive: true });
  await NodeFSP.writeFile(NodePath.join(dir, "proposal.md"), "# Goal\nCited story summaries.");
  await NodeFSP.writeFile(NodePath.join(dir, "tasks.md"), "- [x] First\n- [ ] Second\n- [ ] Third");
  return root;
}
async function mapping(root: string, change: string) {
  await NodeFSP.writeFile(
    NodePath.join(root, "openspec/peer-tasks.json"),
    JSON.stringify({ version: 1, tasks: { [task.id]: change } }),
  );
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => NodeFSP.rm(root, { recursive: true, force: true })),
  );
});
it("reads explicit mappings live, counts tasks and prepares a bounded prompt without writing", async () => {
  const root = await repository();
  await mapping(root, "add-story-summaries");
  const before = await NodeFSP.readdir(NodePath.join(root, "openspec/changes/add-story-summaries"));
  const found = await readTaskSource(root, "app", task);
  expect(found).toMatchObject({
    state: "ready",
    changeId: "add-story-summaries",
    repositoryId: "app",
    completed: 1,
    total: 3,
    design: null,
  });
  if (found.state !== "ready") throw new Error("Expected source");
  expect(found.prompt).toContain("Second");
  expect(found.prompt).toContain("openspec/changes/add-story-summaries/proposal.md");
  expect(found.prompt.length).toBeLessThanOrEqual(20_000);
  await NodeFSP.writeFile(NodePath.join(root, found.sourcePath, "tasks.md"), "- [x] New content");
  expect(await readTaskSource(root, "app", task)).toMatchObject({
    completed: 1,
    total: 1,
    tasks: "- [x] New content",
  });
  expect(await NodeFSP.readdir(NodePath.join(root, found.sourcePath))).toEqual(before);
});
it("uses exact id or key ignoring case, never fuzzy or a stale mapping fallback", async () => {
  const root = await repository("vl36");
  expect(await readTaskSource(root, "app", task)).toMatchObject({
    state: "ready",
    changeId: "vl36",
  });
  await mapping(root, "deleted-change");
  expect(await readTaskSource(root, "app", task)).toMatchObject({
    state: "unavailable",
    reason: expect.stringContaining("Point the entry at the current change"),
  });
  await NodeFSP.mkdir(NodePath.join(root, "openspec/changes/archive/2026-10-20-deleted-change"), {
    recursive: true,
  });
  expect(await readTaskSource(root, "app", task)).toMatchObject({
    state: "unavailable",
    reason: expect.stringContaining(
      "archived as openspec/changes/archive/2026-10-20-deleted-change",
    ),
  });
  await NodeFSP.rm(NodePath.join(root, "openspec/peer-tasks.json"));
  expect(await readTaskSource(root, "app", { ...task, key: "VL3" })).toMatchObject({
    state: "unavailable",
  });
});
it("reports missing docs, absent repositories, malformed maps and ambiguous exact names", async () => {
  const root = await repository("story-task");
  await NodeFSP.rm(NodePath.join(root, "openspec/changes/story-task/tasks.md"));
  expect(await readTaskSource(root, "app", task)).toMatchObject({ state: "unavailable" });
  expect(await readTaskSource(NodePath.join(root, "absent"), "app", task)).toMatchObject({
    state: "unavailable",
  });
  await NodeFSP.writeFile(NodePath.join(root, "openspec/peer-tasks.json"), "{}");
  expect(await readTaskSource(root, "app", task)).toMatchObject({ state: "unavailable" });
  await NodeFSP.rm(NodePath.join(root, "openspec/peer-tasks.json"));
  await NodeFSP.mkdir(NodePath.join(root, "openspec/changes/VL36"));
  expect(await readTaskSource(root, "app", task)).toMatchObject({
    state: "unavailable",
    reason: expect.stringContaining("multiple"),
  });
});
it("rejects traversal mappings and source symlinks escaping the repository", async () => {
  const root = await repository();
  await mapping(root, "../../outside");
  await expect(readTaskSource(root, "app", task)).rejects.toThrow("unsafe");
  await mapping(root, "add-story-summaries");
  const outside = await repository("other");
  const proposal = NodePath.join(root, "openspec/changes/add-story-summaries/proposal.md");
  await NodeFSP.rm(proposal);
  await NodeFSP.symlink(NodePath.join(outside, "openspec/changes/other/proposal.md"), proposal);
  await expect(readTaskSource(root, "app", task)).rejects.toThrow("outside");
});
it("bounds source files rather than returning truncated instructions", async () => {
  const root = await repository("story-task");
  await NodeFSP.writeFile(
    NodePath.join(root, "openspec/changes/story-task/tasks.md"),
    "x".repeat(262_145),
  );
  expect(await readTaskSource(root, "app", task)).toMatchObject({
    state: "unavailable",
    reason: expect.stringContaining("large"),
  });
});
it("supports normalized key-only mappings and refuses conflicting id/key associations", async () => {
  const root = await repository();
  const file = NodePath.join(root, "openspec/peer-tasks.json");
  await NodeFSP.writeFile(
    file,
    JSON.stringify({ version: 1, tasks: { vl36: "add-story-summaries" } }),
  );
  expect(await readTaskSource(root, "app", task)).toMatchObject({ state: "ready" });
  await NodeFSP.writeFile(
    file,
    JSON.stringify({
      version: 1,
      tasks: { vl36: "add-story-summaries", "STORY-TASK": "different" },
    }),
  );
  expect(await readTaskSource(root, "app", task)).toMatchObject({
    state: "unavailable",
    code: "source-unavailable",
  });
  await NodeFSP.writeFile(file, JSON.stringify({ version: 1, tasks: { vl36: "x".repeat(201) } }));
  await expect(readTaskSource(root, "app", task)).rejects.toThrow("unsafe");
});
it("keeps the goal and source references in large prompts and marks omitted checklist content", async () => {
  const root = await repository("story-task");
  await NodeFSP.writeFile(
    NodePath.join(root, "openspec/changes/story-task/proposal.md"),
    "# Proposal\n\n## Why\nPeople need cited story summaries.\n\n## What changes\nDetails",
  );
  await NodeFSP.writeFile(
    NodePath.join(root, "openspec/changes/story-task/tasks.md"),
    "- [ ] Implement a carefully validated item\n".repeat(1000),
  );
  const found = await readTaskSource(root, "app", task);
  if (found.state !== "ready") throw new Error("Expected source");
  expect(found.prompt).toContain("People need cited story summaries.");
  expect(found.prompt).toContain("1000 open checklist items");
  expect(found.prompt).toContain("full checklist in tasks.md");
  expect(found.prompt).toContain("/specs/");
  expect(found.prompt.length).toBeLessThanOrEqual(20_000);
});
it("distinguishes a repository without OpenSpec from a stale mapped source and bounds mapping input", async () => {
  const root = await repository();
  await NodeFSP.rm(NodePath.join(root, "openspec/changes"), { recursive: true });
  expect(await readTaskSource(root, "app", task)).toMatchObject({ code: "not-linked" });
  await mapping(root, "add-story-summaries");
  expect(await readTaskSource(root, "app", task)).toMatchObject({ code: "source-unavailable" });
  await NodeFSP.writeFile(NodePath.join(root, "openspec/peer-tasks.json"), "x".repeat(262_145));
  expect(await readTaskSource(root, "app", task)).toMatchObject({
    code: "source-unavailable",
    reason: expect.stringContaining("large"),
  });
});
it("follows a saved link over the mapping and the name, and reports both", async () => {
  const root = await repository("vl36");
  await NodeFSP.mkdir(NodePath.join(root, "openspec/changes/voices"));
  await NodeFSP.writeFile(
    NodePath.join(root, "openspec/changes/voices/proposal.md"),
    "# Voices\n## Why\nHear them.",
  );
  await NodeFSP.writeFile(NodePath.join(root, "openspec/changes/voices/tasks.md"), "- [ ] Split");
  await mapping(root, "add-story-summaries");
  const read = await readSource(root, "app", task, "voices");
  expect(read).toMatchObject({ changeId: "voices", mapped: "add-story-summaries", named: "vl36" });
  expect(read.snapshot).toMatchObject({
    goal: "Hear them.",
    checklist: [{ text: "Split", done: false }],
  });
  await NodeFSP.rm(NodePath.join(root, "openspec/changes/voices"), { recursive: true });
  await NodeFSP.mkdir(NodePath.join(root, "openspec/changes/archive/2026-10-24-voices"), {
    recursive: true,
  });
  expect(await readSource(root, "app", task, "voices")).toMatchObject({
    gone: true,
    archivedAs: "2026-10-24-voices",
    live: { reason: expect.stringContaining("This task is linked to voices") },
  });
  expect(await readSource(NodePath.join(root, "absent"), "app", task, "voices")).toMatchObject({
    noCheckout: true,
  });
});
it("fingerprints what a brief holds and lists the current changes without the archive", async () => {
  const one = snapshotOf("# P\n## Why\nGoal", "- [x] A\n- [ ] B");
  expect(one).toMatchObject({
    goal: "Goal",
    checklist: [
      { text: "A", done: true },
      { text: "B", done: false },
    ],
  });
  expect(one.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(snapshotOf("# P\n## Why\nGoal", "- [x] A\n- [x] B").fingerprint).not.toBe(one.fingerprint);
  const root = await repository("vl36");
  await NodeFSP.mkdir(NodePath.join(root, "openspec/changes/archive/2026-01-01-old"), {
    recursive: true,
  });
  expect(await listChanges(root)).toEqual([{ name: "vl36", title: "Goal" }]);
});
