/** Reads the configured project store through kontext, including alternate storage locations and ADR styles. */
import {
  asKnowledge,
  kontextApi,
  isKnowledgeIdentity,
  runKontext,
  type KontextClientShape,
  type KontextEntry,
} from "../../../kontext.ts";
import type { KnowledgeEntry } from "../../../knowledgeEntry.ts";

const local: KontextClientShape = { run: runKontext };

export async function readKnowledge(
  root: string,
  client: KontextClientShape = local,
): Promise<KnowledgeEntry[]> {
  const entries: KnowledgeEntry[] = [];
  let offset = 0;
  let snapshot: string | undefined;
  do {
    const page = await kontextApi<{
      entries: KontextEntry[];
      next_offset: number | null;
      snapshot?: string;
    }>(client, root, "entries.list", { active_only: true, limit: 200, offset });
    if (snapshot !== undefined && page.snapshot !== undefined && snapshot !== page.snapshot)
      throw new Error(
        "Project knowledge changed while its index was being read; retaining the last complete index",
      );
    snapshot = page.snapshot;
    entries.push(...page.entries.filter((entry) => isKnowledgeIdentity(entry.id)).map(asKnowledge));
    if (page.next_offset === null || page.next_offset === undefined || page.next_offset <= offset)
      break;
    offset = page.next_offset;
  } while (offset < 400 && entries.length < 400);
  return entries.slice(0, 400);
}

export async function projectGuidance(
  root: string,
  client: KontextClientShape = local,
): Promise<{ readonly id: string; readonly text: string } | null> {
  const page = await kontextApi<{ entries: KontextEntry[] }>(client, root, "entries.list", {
    active_only: true,
    kinds: ["convention"],
    tags: ["peer-skill"],
    limit: 400,
  });
  const best = page.entries
    .filter((entry) => isKnowledgeIdentity(entry.id))
    .toSorted((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id))[0];
  return best === undefined ? null : { id: best.id, text: asKnowledge(best).body.slice(0, 1500) };
}
