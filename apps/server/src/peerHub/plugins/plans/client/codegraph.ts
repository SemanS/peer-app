import * as Schema from "effect/Schema";
import { commandPath, run } from "../../../core/local.ts";

/**
 * The plugin's own reader of CodeGraph, read-only: `codegraph status <root> --json` says whether a
 * checkout's index is ready, and `codegraph node <path> -p <root> --symbols-only --json` lists the
 * symbols of one file. Those are the only two calls it ever makes: it never initializes, builds or
 * refreshes an index (someone else owns that). Each call takes 2 seconds and 1 MiB at most, and a
 * checkout that fails three times in a row is left alone for ten minutes. A binary named by
 * `PEER_CODEGRAPH_BIN`, else `codegraph` on this computer's PATH.
 */
const CALL_MS = 2_000;
const OUTPUT_CAP = 1024 * 1024;
const NAME_CHARS = 200;
const parseJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

export type Runner = (
  binary: string,
  args: ReadonlyArray<string>,
  options: { readonly cwd: string; readonly timeoutMs: number },
) => Promise<string>;

export interface CodeGraph {
  /** Whether the checkout's index is ready: complete, current, and made by CodeGraph 0.50 or later. */
  readonly ready: (root: string, now: number) => Promise<boolean>;
  /** The names the index lists in a file (none for a file it does not hold); rejects when it cannot say. */
  readonly symbols: (root: string, path: string, now: number) => Promise<ReadonlyArray<string>>;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether a `status --json` answer describes an index that is ready: nothing pending, nothing to rebuild. */
export function usable(status: unknown): boolean {
  if (!isRecord(status)) return false;
  const index = isRecord(status.index) ? status.index : {};
  const version =
    typeof status.version === "string" ? /^(\d+)\.(\d+)\./.exec(status.version) : null;
  const pending = isRecord(status.pendingChanges) ? Object.values(status.pendingChanges) : [];
  return (
    status.initialized === true &&
    status.dbExists === true &&
    status.extractionStatus === "current" &&
    version !== null &&
    (Number(version[1]) > 0 || Number(version[2]) >= 50) &&
    !status.worktreeMismatch &&
    status.partial !== true &&
    status.reindexRecommended !== true &&
    index.reindexRecommended !== true &&
    pending.every((entry) => entry === 0 || (Array.isArray(entry) && entry.length === 0))
  );
}

// oxlint-disable-next-line eslint/no-control-regex -- Controls are never part of a symbol's name.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const LISTED = /^- `([^`]+)` \(([^)]*)\)/;

/**
 * The names of the symbols in `path` as `node --symbols-only` lists them, one per line. The map
 * names its own total, so a listing that holds fewer symbols than it says is refused, not trusted.
 */
export function symbolsOf(answer: unknown, path: string): ReadonlyArray<string> {
  if (
    !isRecord(answer) ||
    answer.isError !== false ||
    typeof answer.output !== "string" ||
    answer.query !== path
  )
    throw new Error("unsupported symbol listing");
  const listed = answer.output.split("\n").flatMap((line) => {
    const match = LISTED.exec(line);
    return match === null ? [] : [match];
  });
  const total = /^\*\*[^*]+\*\* — (\d+) symbols?\b/.exec(answer.output);
  if (total !== null && Number(total[1]) > listed.length)
    throw new Error("truncated symbol listing");
  const names = listed
    .filter(([, name = "", kind]) => kind !== "import" && !CONTROL.test(name))
    .map(([, name = ""]) => name)
    .filter((name) => [...name].length <= NAME_CHARS);
  return [...new Set(names)].slice(0, 2_000);
}

export function createCodeGraph(
  options: {
    readonly binary?: string | null;
    readonly run?: Runner;
    readonly timeoutMs?: number;
  } = {},
): CodeGraph {
  const exec: Runner = options.run ?? ((binary, args, at) => run(binary, args, at));
  const states = new Map<string, { readonly ok: boolean; readonly until: number }>();
  const failures = new Map<string, { readonly count: number; readonly until: number }>();
  const listings = new Map<
    string,
    { readonly names: ReadonlyArray<string>; readonly until: number }
  >();

  const call = async (root: string, args: ReadonlyArray<string>, now: number) => {
    const binary = options.binary ?? process.env.PEER_CODEGRAPH_BIN ?? commandPath("codegraph");
    if (binary === null || binary === undefined || binary === "")
      throw new Error("codegraph is not installed");
    try {
      const out = await exec(binary, args, { cwd: root, timeoutMs: options.timeoutMs ?? CALL_MS });
      if (out.length > OUTPUT_CAP) throw new Error("codegraph printed too much");
      const answer = parseJson(out);
      failures.delete(root);
      return answer;
    } catch (error) {
      const count = (failures.get(root)?.count ?? 0) + 1;
      failures.set(root, { count, until: count >= 3 ? now + 600_000 : 0 });
      throw error;
    }
  };
  const paused = (root: string, now: number) => (failures.get(root)?.until ?? 0) > now;

  return {
    ready: async (root, now) => {
      const known = states.get(root);
      if (known !== undefined && known.until > now) return known.ok;
      if (paused(root, now)) return false;
      const ok = await call(root, ["status", root, "--json"], now).then(usable, () => false);
      states.set(root, { ok, until: now + (ok ? 20_000 : 60_000) });
      return ok;
    },
    symbols: async (root, path, now) => {
      const key = `${root}\u0000${path}`;
      const known = listings.get(key);
      if (known !== undefined && known.until > now) return known.names;
      if (paused(root, now)) throw new Error("codegraph is paused for this checkout");
      const names = symbolsOf(
        await call(root, ["node", path, "-p", root, "--symbols-only", "--json"], now),
        path,
      );
      listings.set(key, { names, until: now + 30_000 });
      while (listings.size > 64) listings.delete(listings.keys().next().value!);
      return names;
    },
  };
}
