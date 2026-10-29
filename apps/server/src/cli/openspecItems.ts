// @effect-diagnostics nodeBuiltinImport:off - a repository's openspec/ folder.
/**
 * OpenSpec read into work items (`core/work/workItems.ts`): a change is a root group whose key is
 * the change's id, its `tasks.md` headings are groups, its checkboxes tasks, a checkbox with
 * checkboxes under it a parent item nobody decided yet, a plain bullet a step, and a `Depends on`
 * line dependencies. What Peer does not read (a custom schema's files) is named, never skipped
 * quietly. It sits in the CLI, not in the openspec plugin, because a build may leave that plugin
 * out and the terminal's import still works.
 *
 * @module cli/openspecItems
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { WorkItem } from "../peerHub/core/work/workItems.ts";

/** An active OpenSpec change, as the import reads it. */
export interface Change {
  readonly id: string;
  readonly title: string;
  /** Its capabilities: the folders under `specs/`. */
  readonly capabilities: ReadonlyArray<string>;
  readonly done: number;
  readonly total: number;
}

const GENERIC_TITLE = /^(proposal|change proposal|change)$/i;

/** `add-draft-surveys` → `Add draft surveys`. */
export const titleOfId = (id: string) => {
  const words = id.replace(/[-_]+/g, " ").trim();
  return words === "" ? id : `${words[0]!.toUpperCase()}${words.slice(1)}`;
};

/** The proposal's first heading when it names the change (`# Change: X` → `X`), else the id's words. */
export const changeTitle = (id: string, proposal: string | null) => {
  const heading = proposal
    ?.split("\n")
    .find((line) => /^#\s+\S/.test(line))
    ?.replace(/^#\s+/, "")
    .replace(/^(change|proposal)\s*:\s*/i, "")
    .trim();
  return heading === undefined || heading === "" || GENERIC_TITLE.test(heading)
    ? titleOfId(id)
    : heading.slice(0, 200);
};

/** What the Hub takes as a task key: 2 to 32 characters, letters and digits between dashes. */
const KEY = /^(?=.{2,32}$)[a-z0-9]+(-[a-z0-9]+)*$/i;

const sha = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

/**
 * The task key of a change: its id, or, when the Hub would refuse that (too long, other
 * characters), its first words and a short hash of the whole id, the same on every computer.
 */
export const keyOf = (id: string) => {
  if (KEY.test(id)) return id;
  const hash = sha(id).slice(0, 4);
  const words = id
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
  let head = "";
  for (const word of words) {
    const next = head === "" ? word : `${head}-${word}`;
    if (next.length > 27) break;
    head = next;
  }
  return head === "" ? `os-${hash}` : `${head.slice(0, 27)}-${hash}`;
};

const comparable = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The project area one of the change's capabilities names, when exactly one area matches. */
export const areaOf = (change: Pick<Change, "capabilities">, areas: ReadonlyArray<string>) => {
  const matched = new Set(
    areas.filter((area) =>
      change.capabilities.some((capability) => comparable(capability) === comparable(area)),
    ),
  );
  return matched.size === 1 ? [...matched][0]! : null;
};

const readText = (path: string) => NodeFSP.readFile(path, "utf8").catch(() => null);
const folders = async (path: string) =>
  (await NodeFSP.readdir(path, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
const changesDir = (root: string) => NodePath.join(root, "openspec", "changes");

/** The active changes under `root/openspec/changes`; null when the project has no OpenSpec. */
export async function readChanges(root: string): Promise<ReadonlyArray<Change> | null> {
  const dir = changesDir(root);
  const stat = await NodeFSP.stat(dir).catch(() => null);
  if (stat === null || !stat.isDirectory()) return null;
  const changes: Array<Change> = [];
  for (const id of await folders(dir)) {
    if (id === "archive") continue;
    const tasks = (await readText(NodePath.join(dir, id, "tasks.md"))) ?? "";
    changes.push({
      id,
      title: changeTitle(id, await readText(NodePath.join(dir, id, "proposal.md"))),
      capabilities: await folders(NodePath.join(dir, id, "specs")),
      done: (tasks.match(/^\s*[-*] \[[xX]\]/gm) ?? []).length,
      total: (tasks.match(/^\s*[-*] \[[ xX]\]/gm) ?? []).length,
    });
  }
  return changes;
}

/** The Hub keeps this much of a title; the whole text then opens the description. */
const TITLE_LIMIT = 120;
const READ_LIMIT = 200;
const KNOWN = new Set(["proposal.md", "design.md", "tasks.md", "specs"]);

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const CHECKBOX = /^([ \t]*)[-*+]\s+\[([ xX])\]\s*(.*)$/;
const BULLET = /^([ \t]*)[-*+]\s+(.*)$/;
const LABEL = /^(\d+(?:\.\d+)*)\.?\s+(.*)$/;
const DEPENDS = /^depends on\s*:?\s*(.+?)\.?$/i;
const TRAILING_DEPENDS = /\s*\((?:depends on|after)\s*:?\s*([^)]*)\)\s*$/i;

const indentOf = (space: string) => [...space].reduce((n, c) => n + (c === "\t" ? 4 : 1), 0);
const LABEL_WORD = /^\d+(?:\.\d+)*$/;
/**
 * The item labels a `Depends on` line names: `1.2`, `2.1 and 2.3`, `none`. Prose around them
 * ("1.2. Mock the service, so this does not wait on 2.3") would name items it does not depend on,
 * so only the words before the first one that is neither a label nor a joiner count.
 */
const labelsIn = (text: string) => {
  const labels: Array<string> = [];
  for (const word of text.split(/[\s,;]+/)) {
    const label = word.replace(/[.:]+$/, "");
    if (label === "" || /^(and|or|then|none|nothing|-|—)$/i.test(label)) continue;
    if (!LABEL_WORD.test(label)) break;
    labels.push(label);
  }
  return labels;
};

/** A title the Hub keeps whole, and the text it would cut, for the description's first line. */
const titled = (text: string) => {
  const chars = [...text.trim().replace(/\s+/g, " ")].slice(0, READ_LIMIT);
  const whole = chars.join("");
  if (chars.length <= TITLE_LIMIT) return { title: whole, long: undefined };
  // A long item reads better cut where its first sentence or clause ends than mid-word.
  const head = chars.slice(0, TITLE_LIMIT).join("");
  const stop = Math.max(head.lastIndexOf(". "), head.lastIndexOf(": "), head.lastIndexOf("; "));
  const title = stop >= 24 ? head.slice(0, stop) : head.replace(/\s+\S*$/, "");
  return { title: title.trimEnd(), long: whole };
};

interface Draft {
  ref: string;
  parent: string | null;
  kind: WorkItem["kind"];
  title: string;
  executable: boolean;
  unsettled: boolean;
  position: number;
  done: boolean;
  dependencies: Array<string>;
  dependsOn: Array<string>;
  description?: string;
}

/**
 * A change's `tasks.md` as items under the root `root`: headings nest by level, list items by
 * indentation, whatever unit the file indents with.
 */
const parseTasks = (id: string, root: string, text: string) => {
  const items: Array<Draft> = [];
  const byLabel = new Map<string, string>();
  const used = new Set<string>();
  const positions = new Map<string, number>();
  const place = (parent: string) => {
    const at = positions.get(parent) ?? 0;
    positions.set(parent, at + 1);
    return at;
  };
  const unique = (ref: string) => {
    let candidate = ref;
    for (let n = 2; used.has(candidate); n++) candidate = `${ref}-${n}`;
    used.add(candidate);
    return candidate;
  };
  const headings: Array<{ level: number; ref: string }> = [];
  let list: Array<{ indent: number; draft: Draft }> = [];
  const heading = () => headings.at(-1)?.ref ?? root;
  /** The task a list line at `indent` sits under, when one does. */
  const enclosing = (indent: number) => {
    while (list.length > 0 && list.at(-1)!.indent >= indent) list.pop();
    return list.at(-1)?.draft;
  };
  /** What a step or a `Depends on` line at `indent` belongs to; it leaves the list as it is. */
  const owner = (indent: number) =>
    list.findLast((entry) => entry.indent < indent)?.draft ??
    items.find((item) => item.ref === heading());

  for (const line of text.split("\n")) {
    const h = HEADING.exec(line);
    if (h !== null) {
      const level = h[1]!.length;
      list = [];
      if (level === 1) continue;
      while (headings.length > 0 && headings.at(-1)!.level >= level) headings.pop();
      const parent = heading();
      const text = h[2]!;
      const ref = unique(`${id}#h:${sha(`${parent}\n${text}`).slice(0, 8)}`);
      const label = LABEL.exec(text);
      if (label !== null) byLabel.set(label[1]!, ref);
      const { title, long } = titled(label?.[2] ?? text);
      items.push({
        ref,
        parent,
        kind: "group",
        title,
        executable: false,
        unsettled: false,
        position: place(parent),
        done: false,
        dependencies: [],
        dependsOn: [],
        ...(long === undefined ? {} : { description: long }),
      });
      headings.push({ level, ref });
      continue;
    }
    const box = CHECKBOX.exec(line);
    if (box !== null) {
      const indent = indentOf(box[1]!);
      const parent = enclosing(indent)?.ref ?? heading();
      let body = box[3]!;
      const dependsOn: Array<string> = [];
      const trailing = TRAILING_DEPENDS.exec(body);
      if (trailing !== null) {
        dependsOn.push(...labelsIn(trailing[1]!));
        body = body.slice(0, trailing.index);
      }
      const label = LABEL.exec(body);
      const { title, long } = titled(label?.[2] ?? body);
      const ref = unique(
        label === null
          ? `${id}#${sha(`${parent}\n${title.toLowerCase()}`).slice(0, 8)}`
          : `${id}#${label[1]}`,
      );
      if (label !== null) byLabel.set(label[1]!, ref);
      const draft: Draft = {
        ref,
        parent,
        kind: "task",
        title,
        executable: true,
        unsettled: false,
        position: place(parent),
        done: box[2] !== " ",
        dependencies: [],
        dependsOn,
        ...(long === undefined ? {} : { description: long }),
      };
      const above = items.find((item) => item.ref === parent);
      // A checkbox with checkboxes under it may run as one or by its parts: a person decides.
      if (above?.kind === "task") {
        above.executable = false;
        above.unsettled = true;
      }
      items.push(draft);
      list.push({ indent, draft });
      continue;
    }
    const bullet = BULLET.exec(line);
    const plain = bullet === null ? line.trim() : bullet[2]!.trim();
    const depends = DEPENDS.exec(plain);
    if (depends !== null) {
      owner(bullet === null ? Number.MAX_SAFE_INTEGER : indentOf(bullet[1]!))?.dependsOn.push(
        ...labelsIn(depends[1]!),
      );
      continue;
    }
    if (bullet === null || plain === "") continue;
    const at = owner(indentOf(bullet[1]!));
    if (at === undefined) continue;
    items.push({
      ref: unique(`${at.ref}~${sha(plain).slice(0, 8)}`),
      parent: at.ref,
      kind: "step",
      title: plain,
      executable: false,
      unsettled: false,
      position: 0,
      done: false,
      dependencies: [],
      dependsOn: [],
    });
  }
  const unknown: Array<string> = [];
  for (const item of items) {
    for (const label of item.dependsOn) {
      const ref = byLabel.get(label);
      if (ref === undefined) unknown.push(label);
      else if (ref !== item.ref && !item.dependencies.includes(ref)) item.dependencies.push(ref);
    }
  }
  return { items, unknown };
};

/**
 * One change as work items, in tree order, and what of it Peer did not read. `areas` are the
 * project's, for the root's area.
 */
export async function readChange(
  root: string,
  id: string,
  areas: ReadonlyArray<string> = [],
): Promise<{
  readonly items: ReadonlyArray<WorkItem>;
  readonly notInterpreted: ReadonlyArray<string>;
}> {
  const dir = NodePath.join(changesDir(root), id);
  const at = (name: string) => `openspec/changes/${id}/${name}`;
  const capabilities = await folders(NodePath.join(dir, "specs"));
  const entries = (await NodeFSP.readdir(dir, { withFileTypes: true }).catch(() => [])).filter(
    (entry) => !entry.name.startsWith("."),
  );
  const has = (name: string) => entries.some((entry) => entry.name === name);
  const notInterpreted = entries
    .filter((entry) => !KNOWN.has(entry.name))
    .map((entry) => at(entry.isDirectory() ? `${entry.name}/` : entry.name))
    .sort();
  const context = [
    ...(has("proposal.md") ? [at("proposal.md")] : []),
    ...(has("design.md") ? [at("design.md")] : []),
    ...capabilities.map((capability) => at(`specs/${capability}/spec.md`)),
  ];
  const { title, long } = titled(
    changeTitle(id, await readText(NodePath.join(dir, "proposal.md"))),
  );
  const description = [
    ...(long === undefined ? [] : [long]),
    ...(context.length === 0 ? [] : [`Context: ${context.join(", ")}`]),
  ].join("\n");
  const tasks = await readText(NodePath.join(dir, "tasks.md"));
  const parsed = parseTasks(id, id, tasks ?? "");
  const tree = parsed.items.some((item) => item.kind === "task");
  if (tasks === null) notInterpreted.push(`${at("")}: no tasks.md, imported as one task`);
  else if (!tree) notInterpreted.push(`${at("tasks.md")}: no checkbox, imported as one task`);
  if (tree && parsed.unknown.length > 0) {
    notInterpreted.push(
      `${at("tasks.md")}: depends on ${[...new Set(parsed.unknown)].join(", ")}, which names no item`,
    );
  }
  const schema = /^schema\s*:\s*["']?([^"'\s#]+)/m.exec(
    (await readText(NodePath.join(root, "openspec", "config.yaml"))) ?? "",
  )?.[1];
  if (schema !== undefined && schema !== "spec-driven") {
    notInterpreted.push(`schema ${schema}: Peer reads tasks.md checklists only`);
  }
  const rootItem: WorkItem = {
    ref: id,
    parent: null,
    kind: tree ? "group" : "task",
    title,
    executable: !tree,
    unsettled: false,
    position: 0,
    done: false,
    dependencies: [],
    key: keyOf(id),
    area: areaOf({ capabilities }, areas),
    ...(description === "" ? {} : { description }),
  };
  return {
    items: [
      rootItem,
      ...(tree ? parsed.items.map(({ dependsOn: _labels, ...item }): WorkItem => item) : []),
    ],
    notInterpreted,
  };
}
