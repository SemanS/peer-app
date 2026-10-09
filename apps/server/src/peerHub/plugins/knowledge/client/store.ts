// @effect-diagnostics nodeBuiltinImport:off - reads a repository's reviewed knowledge files.
/**
 * kontext's store on disk: a project's reviewed knowledge in `.ai/` of its repository, one markdown
 * file per entry in a folder per kind, kept where `kontext init` ran.
 *
 * @module peerHub/plugins/knowledge/client/store
 */
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { entryParts, parseEntry, type KnowledgeEntry } from "../../../knowledgeEntry.ts";

/** Whether a checkout keeps kontext knowledge: `kontext init` ran there. */
export function hasStore(root: string): boolean {
  return NodeFS.existsSync(NodePath.join(root, ".ai", "kontext.toml"));
}

const FOLDERS = ["decisions", "conventions", "learnings", "incidents"] as const;
const MAX_ENTRIES = 400;
const MAX_FILE_BYTES = 64 * 1024;

/** The entries of a repository's `.ai` store, in no order; none when it has no store. */
export async function readKnowledge(root: string): Promise<KnowledgeEntry[]> {
  const entries: KnowledgeEntry[] = [];
  for (const folder of FOLDERS) {
    const dir = NodePath.join(root, ".ai", folder);
    const names = await NodeFSP.readdir(dir).catch(() => [] as string[]);
    for (const name of names) {
      // A name that is not a plain file name is not an entry Peer points an agent to.
      if (!/^[\p{L}\p{N}_.-]{1,160}\.md$/u.test(name) || entries.length >= MAX_ENTRIES) continue;
      const path = NodePath.join(dir, name);
      const stat = await NodeFSP.stat(path).catch(() => null);
      if (stat === null || !stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
      const text = await NodeFSP.readFile(path, "utf8").catch(() => null);
      const entry = text === null ? undefined : parseEntry(text, `.ai/${folder}/${name}`);
      if (entry !== undefined) entries.push(entry);
    }
  }
  return entries;
}

/**
 * The project's own guidance for its agents on what to mark `[project]`: the
 * newest convention in its knowledge tagged `peer-skill`, unless superseded.
 */
export async function projectGuidance(
  root: string,
): Promise<{ readonly id: string; readonly text: string } | null> {
  const dir = NodePath.join(root, ".ai", "conventions");
  const files = await NodeFSP.readdir(dir).catch(() => [] as string[]);
  let best: { id: string; text: string; date: string } | null = null;
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const text = await NodeFSP.readFile(NodePath.join(dir, file), "utf8").catch(() => "");
    const { fields, body } = entryParts(text);
    if (!/\bpeer-skill\b/.test(fields.tags ?? "") || fields.status === "superseded") continue;
    const date = fields.date ?? "";
    if (best === null || date >= best.date) {
      best = { id: fields.id ?? file.replace(/\.md$/, ""), text: body.slice(0, 1500), date };
    }
  }
  return best === null ? null : { id: best.id, text: best.text };
}
