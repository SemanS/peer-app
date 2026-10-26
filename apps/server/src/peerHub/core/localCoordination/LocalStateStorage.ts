// @effect-diagnostics nodeBuiltinImport:off - the Local authority's serialized persistence boundary.
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

type ObjectState = Readonly<Record<string, unknown>>;
type Delta =
  | { readonly kind: "value"; readonly value: unknown }
  | { readonly kind: "remove" }
  | { readonly kind: "tail"; readonly drop: number; readonly append: readonly unknown[] }
  | {
      readonly kind: "splice";
      readonly start: number;
      readonly remove: number;
      readonly insert: readonly unknown[];
    }
  | { readonly kind: "record"; readonly entries: Readonly<Record<string, Delta>> };
interface Pointer {
  readonly storageFormat: 1;
  readonly snapshot: string;
  readonly journal: string;
  readonly bytes: number;
  readonly sequence: number;
  readonly head: string;
}
interface JournalEntry {
  readonly sequence: number;
  readonly previous: string;
  readonly patch: Readonly<Record<string, Delta>>;
  readonly hash: string;
}
const hash = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");
const object = (value: unknown): value is ObjectState =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const validHash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown): value is number =>
  Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
const RECORD_FIELDS = new Set(["contexts", "versions", "manifests"]);

function arrayDelta(before: readonly unknown[], after: readonly unknown[]): Delta {
  const last = before.at(-1);
  const end = last === undefined ? -1 : after.indexOf(last);
  const shared = end + 1;
  if (
    before.length === 0 ||
    (shared > 0 &&
      shared <= before.length &&
      after
        .slice(0, shared)
        .every((value, index) => value === before[before.length - shared + index]))
  ) {
    return { kind: "tail", drop: before.length - shared, append: after.slice(shared) };
  }
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let suffix = 0;
  while (
    suffix < before.length - start &&
    suffix < after.length - start &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  )
    suffix++;
  return {
    kind: "splice",
    start,
    remove: before.length - start - suffix,
    insert: after.slice(start, after.length - suffix),
  };
}
function fieldDelta(before: unknown, after: unknown, records = false): Delta {
  if (Array.isArray(before) && Array.isArray(after)) return arrayDelta(before, after);
  if (records && object(before) && object(after))
    return { kind: "record", entries: stateDelta(before, after) };
  return { kind: "value", value: after };
}
function stateDelta(before: ObjectState, after: ObjectState): Record<string, Delta> {
  return Object.fromEntries(
    [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) =>
      before[key] === after[key]
        ? []
        : [
            [
              key,
              key in after
                ? fieldDelta(before[key], after[key], RECORD_FIELDS.has(key))
                : { kind: "remove" },
            ],
          ],
    ),
  );
}
function applyDelta(before: unknown, delta: Delta): unknown {
  switch (delta.kind) {
    case "value":
      return delta.value;
    case "remove":
      return undefined;
    case "tail":
      if (
        !Array.isArray(before) ||
        !integer(delta.drop) ||
        delta.drop > before.length ||
        !Array.isArray(delta.append)
      )
        throw new Error("Invalid Local journal array delta.");
      return [...before.slice(delta.drop), ...delta.append];
    case "splice":
      if (
        !Array.isArray(before) ||
        !integer(delta.start) ||
        !integer(delta.remove) ||
        delta.start + delta.remove > before.length ||
        !Array.isArray(delta.insert)
      )
        throw new Error("Invalid Local journal array delta.");
      return [
        ...before.slice(0, delta.start),
        ...delta.insert,
        ...before.slice(delta.start + delta.remove),
      ];
    case "record": {
      if (!object(before) || !object(delta.entries))
        throw new Error("Invalid Local journal record delta.");
      const entries = new Map(Object.entries(before));
      for (const [key, change] of Object.entries(delta.entries)) {
        if (!object(change)) throw new Error("Invalid Local journal change.");
        if (change.kind === "remove") entries.delete(key);
        else entries.set(key, applyDelta(entries.get(key), change));
      }
      return Object.fromEntries(entries);
    }
    default:
      throw new Error("Unknown Local journal delta.");
  }
}

/** The environment server is the single writer, as for the previous JSON file. One commit pointer makes an fsynced journal prefix authoritative; history is serialized only at compaction. */
export class LocalStateStorage {
  private pointer: Pointer | undefined;
  private poisoned: unknown;
  private persisted: ObjectState | undefined;
  private loaded = false;
  private readonly directory: string;
  private readonly file: string;
  private readonly compactAfterBytes: number;
  private readonly platform: NodeJS.Platform;
  constructor(
    file: string,
    options: { readonly compactAfterBytes?: number; readonly platform?: NodeJS.Platform } = {},
  ) {
    this.file = file;
    this.directory = `${file}.store`;
    this.compactAfterBytes = options.compactAfterBytes ?? 64 * 1024 * 1024;
    this.platform = options.platform ?? HostProcess.Platform.defaultValue();
  }
  private async syncDirectory(path: string) {
    // Node cannot open directory handles on Windows; files are still synced before rename.
    if (this.platform === "win32") return;
    const directory = await NodeFSP.open(path, "r");
    try {
      await directory.sync().catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EINVAL" && error.code !== "ENOTSUP" && error.code !== "EOPNOTSUPP")
          throw error;
      });
    } finally {
      await directory.close();
    }
  }
  assertHealthy() {
    if (this.poisoned !== undefined)
      throw new Error("Local persistence requires a restart after an uncertain commit.", {
        cause: this.poisoned,
      });
  }
  private snapshotPath(pointer: Pointer) {
    return NodePath.join(this.directory, `${pointer.snapshot}.snapshot.json`);
  }
  private journalPath(pointer: Pointer) {
    return NodePath.join(this.directory, pointer.journal);
  }
  private async atomic(path: string, text: string, commit = false) {
    const temp = `${path}.${NodeCrypto.randomUUID()}.tmp`;
    let renamed = false;
    try {
      const handle = await NodeFSP.open(temp, "wx", 0o600);
      try {
        await handle.writeFile(text);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await NodeFSP.rename(temp, path);
      renamed = true;
      await this.syncDirectory(NodePath.dirname(path));
    } catch (error) {
      if (commit && renamed) this.poisoned = error;
      throw error;
    } finally {
      await NodeFSP.rm(temp, { force: true }).catch(() => undefined);
    }
  }
  private async baseline(state: ObjectState): Promise<Pointer> {
    const text = JSON.stringify(state);
    const snapshot = hash(text);
    const pointer: Pointer = {
      storageFormat: 1,
      snapshot,
      journal: `${NodeCrypto.randomUUID()}.journal`,
      bytes: 0,
      sequence: 0,
      head: snapshot,
    };
    try {
      await this.atomic(this.snapshotPath(pointer), text);
      const journal = await NodeFSP.open(this.journalPath(pointer), "wx", 0o600);
      try {
        await journal.sync();
      } finally {
        await journal.close();
      }
      await this.syncDirectory(this.directory);
    } catch (error) {
      await NodeFSP.rm(this.journalPath(pointer), { force: true }).catch(() => undefined);
      if (pointer.snapshot !== this.pointer?.snapshot)
        await NodeFSP.rm(this.snapshotPath(pointer), { force: true }).catch(() => undefined);
      throw error;
    }
    return pointer;
  }
  async load<S extends ObjectState>(decode: (value: unknown) => S): Promise<S | null> {
    this.assertHealthy();
    const text = await NodeFSP.readFile(this.file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (text === null) {
      const files = await NodeFSP.readdir(this.directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      if (files.length > 0)
        throw new Error(
          "Local authority commit pointer is missing; retained evidence cannot establish an empty state.",
        );
      this.loaded = true;
      return null;
    }
    const parsed: unknown = JSON.parse(text);
    if (!object(parsed) || parsed.storageFormat === undefined) {
      const state = decode(parsed);
      this.persisted = state;
      this.loaded = true;
      return state;
    }
    if (
      parsed.storageFormat !== 1 ||
      !validHash(parsed.snapshot) ||
      !validHash(parsed.head) ||
      typeof parsed.journal !== "string" ||
      !/^[a-f0-9-]{36}\.journal$/.test(parsed.journal) ||
      !integer(parsed.bytes) ||
      !integer(parsed.sequence)
    )
      throw new Error("Invalid Local persistence commit pointer.");
    const pointer: Pointer = {
      storageFormat: 1,
      snapshot: parsed.snapshot,
      head: parsed.head,
      journal: parsed.journal,
      bytes: parsed.bytes,
      sequence: parsed.sequence,
    };
    const snapshot = await NodeFSP.readFile(this.snapshotPath(pointer), "utf8");
    if (hash(snapshot) !== pointer.snapshot)
      throw new Error("Local authority snapshot checksum differs.");
    let state: unknown = JSON.parse(snapshot);
    const journal = await NodeFSP.open(this.journalPath(pointer), "r");
    let content: string;
    try {
      if ((await journal.stat()).size < pointer.bytes)
        throw new Error("Committed Local journal data is missing.");
      const bytes = Buffer.alloc(pointer.bytes);
      let offset = 0;
      while (offset < bytes.length) {
        const result = await journal.read(bytes, offset, bytes.length - offset, offset);
        if (result.bytesRead === 0) throw new Error("Committed Local journal data ended early.");
        offset += result.bytesRead;
      }
      content = bytes.toString("utf8");
    } finally {
      await journal.close();
    }
    if (content !== "" && !content.endsWith("\n"))
      throw new Error("Committed Local journal record is partial.");
    let previous = pointer.snapshot;
    let sequence = 0;
    for (const line of content.split("\n").filter(Boolean)) {
      const value: unknown = JSON.parse(line);
      if (
        !object(value) ||
        value.sequence !== sequence + 1 ||
        value.previous !== previous ||
        !object(value.patch) ||
        !validHash(value.hash)
      )
        throw new Error("Local journal sequence is invalid.");
      const entry = value as unknown as JournalEntry;
      const payload = JSON.stringify({
        sequence: entry.sequence,
        previous: entry.previous,
        patch: entry.patch,
      });
      if (hash(payload) !== entry.hash) throw new Error("Local journal checksum differs.");
      state = applyDelta(state, { kind: "record", entries: entry.patch });
      previous = entry.hash;
      sequence++;
    }
    if (sequence !== pointer.sequence || previous !== pointer.head)
      throw new Error("Local journal commit is missing.");
    const result = decode(state);
    this.pointer = pointer;
    this.persisted = result;
    this.loaded = true;
    return result;
  }
  async save(after: ObjectState) {
    this.assertHealthy();
    if (!this.loaded) throw new Error("Load Local persistence before writing it.");
    await NodeFSP.mkdir(NodePath.dirname(this.file), { recursive: true, mode: 0o700 });
    await NodeFSP.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const old = this.pointer;
    let prepared: Pointer | undefined;
    try {
      let next: Pointer;
      if (old === undefined) {
        next = await this.baseline(after);
        prepared = next;
      } else {
        const base = old;
        const payload = {
          sequence: base.sequence + 1,
          previous: base.head,
          patch: stateDelta(this.persisted!, after),
        };
        const entry = JSON.stringify({ ...payload, hash: hash(JSON.stringify(payload)) }) + "\n";
        if (base.bytes + Buffer.byteLength(entry) > this.compactAfterBytes) {
          next = await this.baseline(after);
          prepared = next;
        } else {
          const journal = await NodeFSP.open(this.journalPath(base), "r+");
          try {
            if ((await journal.stat()).size < base.bytes)
              throw new Error("Committed Local journal data is missing.");
            await journal.truncate(base.bytes);
            const bytes = Buffer.from(entry);
            let offset = 0;
            while (offset < bytes.length) {
              const result = await journal.write(
                bytes,
                offset,
                bytes.length - offset,
                base.bytes + offset,
              );
              if (result.bytesWritten === 0)
                throw new Error("Local journal write made no progress.");
              offset += result.bytesWritten;
            }
            await journal.sync();
          } finally {
            await journal.close();
          }
          next = {
            ...base,
            bytes: base.bytes + Buffer.byteLength(entry),
            sequence: payload.sequence,
            head: hash(JSON.stringify(payload)),
          };
        }
      }
      await this.atomic(this.file, JSON.stringify(next), true);
      this.pointer = next;
      this.persisted = after;
      if (old !== undefined && old.journal !== next.journal) {
        await NodeFSP.rm(this.journalPath(old), { force: true }).catch(() => undefined);
        if (old.snapshot !== next.snapshot)
          await NodeFSP.rm(this.snapshotPath(old), { force: true }).catch(() => undefined);
      }
    } catch (error) {
      if (
        prepared !== undefined &&
        prepared.journal !== old?.journal &&
        this.poisoned === undefined
      ) {
        await NodeFSP.rm(this.journalPath(prepared), { force: true }).catch(() => undefined);
        if (prepared.snapshot !== old?.snapshot)
          await NodeFSP.rm(this.snapshotPath(prepared), { force: true }).catch(() => undefined);
      }
      throw error;
    }
  }
}
