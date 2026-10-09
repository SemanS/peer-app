// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - local JSON files are decoded with the wire schema; state holds bounded private observer cursors.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import { PeerMetricsRow, type PeerMetricsRow as Row } from "@t3tools/contracts";
export const dayOf = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms)).slice(0, 10);
export const dayAt = (day: string, delta: number) =>
  dayOf(Date.parse(`${day}T00:00:00Z`) + delta * 86400000);
export interface WorkspaceConsent {
  sharing: boolean;
  sharedSince?: string | undefined;
  epoch?: number | undefined;
  markers: Record<string, { rev: number; at: number }>;
  eraseOwed?: boolean | undefined;
  repeatEraseAt?: number | undefined;
  lastUpload?: number | undefined;
}
export interface PersonState {
  workspaces: Record<string, WorkspaceConsent>;
  debugUntil?: number | undefined;
  cursors: Record<string, { updated: number; completed: number }>;
  checked: string[];
  conflicting: string[];
  seededPr?: boolean | undefined;
}
export const freshPerson = (): PersonState => ({
  workspaces: Object.create(null) as PersonState["workspaces"],
  cursors: Object.create(null) as PersonState["cursors"],
  checked: [],
  conflicting: [],
});
const emptyConsent = (): WorkspaceConsent => ({
  sharing: false,
  markers: Object.create(null) as WorkspaceConsent["markers"],
});
const finiteCount = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
const boundedKey = Schema.String.check(Schema.isMaxLength(512));
const savedPerson = Schema.Struct({
  workspaces: Schema.Record(
    Schema.String,
    Schema.Struct({
      sharing: Schema.Boolean,
      sharedSince: Schema.optional(Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))),
      epoch: Schema.optional(finiteCount),
      markers: Schema.Record(boundedKey, Schema.Struct({ rev: finiteCount, at: finiteCount })),
      eraseOwed: Schema.optional(Schema.Boolean),
      repeatEraseAt: Schema.optional(finiteCount),
      lastUpload: Schema.optional(finiteCount),
    }),
  ),
  debugUntil: Schema.optional(finiteCount),
  cursors: Schema.Record(
    boundedKey,
    Schema.Struct({ updated: finiteCount, completed: finiteCount }),
  ),
  checked: Schema.Array(boundedKey),
  conflicting: Schema.Array(boundedKey),
  seededPr: Schema.optional(Schema.Boolean),
});
const decodeRow = Schema.decodeUnknownSync(PeerMetricsRow);
const decodePerson = Schema.decodeUnknownSync(savedPerson);
const nullRecord = <A>(entries: Iterable<readonly [string, A]>): Record<string, A> =>
  Object.assign(Object.create(null), Object.fromEntries(entries)) as Record<string, A>;
const safe = (v: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(v)) throw Error("invalid metrics path id");
  return v;
};
const checkedDay = (v: string) => {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(`${v}T00:00:00Z`)) ||
    dayOf(Date.parse(`${v}T00:00:00Z`)) !== v
  )
    throw Error("invalid metrics day");
  return v;
};
export function createLocalStore(root: string, now: () => number) {
  const completed = new Map<string, Row>();
  let people: Record<string, PersonState> = Object.create(null) as Record<string, PersonState>,
    queue = Promise.resolve();
  const fileOf = (workspace: string, project: string, day: string) =>
    NodePath.join(root, safe(workspace), safe(project), `${checkedDay(day)}.json`);
  const write = async (file: string, value: unknown) => {
    await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    await NodeFSP.writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
    await NodeFSP.rename(tmp, file);
  };
  const atomic = (f: () => Promise<void>) => {
    const next = queue.then(f);
    queue = next.catch(() => undefined);
    return next;
  };
  const corrupt = async (file: string) => {
    await NodeFSP.rename(file, `${file}.corrupt.${now()}`).catch(() => undefined);
  };
  const read = async (workspace: string, project: string, day: string): Promise<Row | null> => {
    const file = fileOf(workspace, project, day);
    if (day < dayOf(now()) && completed.has(file)) return completed.get(file)!;
    let raw: string;
    try {
      raw = await NodeFSP.readFile(file, "utf8");
    } catch (e) {
      if ((e as { code?: string }).code === "ENOENT") return null;
      throw e;
    }
    try {
      const row = decodeRow(JSON.parse(raw));
      if (day < dayOf(now())) completed.set(file, row);
      return row;
    } catch {
      await corrupt(file);
      return null;
    }
  };
  const files = async () => {
    const result: { workspace: string; project: string; day: string; file: string }[] = [];
    for (const w of await NodeFSP.readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!w.isDirectory() || !/^[A-Za-z0-9_-]+$/.test(w.name)) continue;
      for (const p of await NodeFSP.readdir(NodePath.join(root, w.name), { withFileTypes: true })) {
        if (!p.isDirectory() || !/^[A-Za-z0-9_-]+$/.test(p.name)) continue;
        for (const f of await NodeFSP.readdir(NodePath.join(root, w.name, p.name), {
          withFileTypes: true,
        }))
          if (f.isFile() && /^\d{4}-\d{2}-\d{2}\.json$/.test(f.name))
            result.push({
              workspace: w.name,
              project: p.name,
              day: f.name.slice(0, 10),
              file: NodePath.join(root, w.name, p.name, f.name),
            });
      }
    }
    return result;
  };
  return {
    root,
    read,
    files,
    person(email: string) {
      return (people[email] ??= freshPerson());
    },
    consent(email: string, workspace: string) {
      safe(workspace);
      return ((people[email] ??= freshPerson()).workspaces[workspace] ??= emptyConsent());
    },
    async load() {
      const file = NodePath.join(root, "state.json");
      try {
        const raw: unknown = JSON.parse(await NodeFSP.readFile(file, "utf8"));
        if (typeof raw !== "object" || raw === null) throw Error("invalid metrics state");
        for (const [email, person] of Object.entries(raw)) {
          const p = decodePerson(person);
          for (const [workspace, consent] of Object.entries(p.workspaces)) {
            safe(workspace);
            if (consent.sharedSince) checkedDay(consent.sharedSince);
          }
          // Restart never expands cursors or PR sets beyond their collection bounds.
          people[email] = {
            ...p,
            workspaces: nullRecord(
              Object.entries(p.workspaces).map(
                ([w, c]) => [w, { ...c, markers: nullRecord(Object.entries(c.markers)) }] as const,
              ),
            ),
            checked: p.checked.slice(-5000),
            conflicting: p.conflicting.slice(-5000),
            cursors: nullRecord(Object.entries(p.cursors).slice(-5000)),
          };
        }
      } catch (e) {
        if ((e as { code?: string }).code !== "ENOENT") {
          people = Object.create(null) as Record<string, PersonState>;
          await corrupt(file);
        }
      }
      await this.prune();
    },
    saveState: () => atomic(() => write(NodePath.join(root, "state.json"), people)),
    save(workspace: string, project: string, day: string, row: Row) {
      const file = fileOf(workspace, project, day);
      return atomic(async () => {
        await write(file, row);
        if (day < dayOf(now())) completed.set(file, row);
      });
    },
    async prune() {
      const cutoff = dayAt(dayOf(now()), -400);
      for (const f of await files())
        if (f.day < cutoff) {
          await NodeFSP.rm(f.file, { force: true });
          completed.delete(f.file);
        }
    },
    eraseAll: () =>
      atomic(async () => {
        await NodeFSP.rm(root, { recursive: true, force: true });
        completed.clear();
      }),
  };
}
export type LocalStore = ReturnType<typeof createLocalStore>;
