import type { PeerImpactRootState } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { commandPath } from "../../../core/local.ts";
import { runProcess, type Runner } from "./process.ts";
import { BudgetExceeded } from "../scheduler.ts";
// oxlint-disable-next-line eslint/no-control-regex -- Repository paths reject controls.
export const repositoryPath = (value: string) =>
  value !== "" &&
  value.length <= 4096 &&
  !/^[\/\\-]|[\u0000-\u001f\u007f\\]/.test(value) &&
  !value.startsWith("task:") &&
  !value.endsWith("/") &&
  !value.split("/").some((p) => p === "." || p === ".." || p === "");
// oxlint-disable-next-line eslint/no-control-regex -- Symbol identifiers reject controls.
export const symbolName = (value: string) =>
  value.length > 0 && Array.from(value).length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
export type SymbolMap = {
  name: string;
  path: string;
  start: number;
  end: number;
  signature: string;
};
export const healthKey = (h: Health | undefined) =>
  JSON.stringify(
    h
      ? {
          state: h.state,
          commands: h.commands,
          pending: h.pending ? [...h.pending] : null,
          lastIndexed: h.lastIndexed ?? null,
        }
      : null,
  );
export type Health = PeerImpactRootState & { pending: Set<string> | null; lastIndexed?: number };
const object = Schema.Record(Schema.String, Schema.Unknown),
  record = Schema.decodeUnknownSync(object);
const quote = (root: string) => `'${root.replaceAll("'", "'\\''")}'`;
export function decodeHealth(root: string, value: unknown): Health {
  const v = record(value),
    idx = v.index === undefined ? {} : record(v.index),
    base = { root, commands: [] as string[], pending: new Set<string>() };
  const version = typeof v.version === "string" ? /^(\d+)\.(\d+)\./.exec(v.version) : null;
  if (v.extractionStatus === "corrupt")
    return {
      ...base,
      state: "corrupt",
      commands: typeof v.recoveryCommand === "string" ? [v.recoveryCommand] : [],
    };
  if (v.initialized !== true || v.dbExists !== true)
    return { ...base, state: "uninitialized", commands: [`codegraph init ${quote(root)}`] };
  if (!version || !(Number(version[1]) > 0 || Number(version[2]) >= 50))
    return { ...base, state: "failed" };
  if (v.worktreeMismatch)
    return {
      ...base,
      state: "mismatch",
      commands: typeof v.recoveryCommand === "string" ? [v.recoveryCommand] : [],
    };
  if (v.partial === true || idx.reindexRecommended === true || v.reindexRecommended === true)
    return { ...base, state: "partial", commands: [`codegraph index ${quote(root)}`] };
  if (v.extractionStatus !== "current")
    return {
      ...base,
      state: "corrupt",
      commands:
        typeof v.recoveryCommand === "string"
          ? [v.recoveryCommand]
          : [`codegraph status ${quote(root)} --json`],
    };
  let unknown = false;
  const pending = record(v.pendingChanges ?? {}),
    paths = new Set<string>();
  for (const field of [pending.added, pending.modified, pending.removed]) {
    if (typeof field === "number") {
      if (field > 0) unknown = true;
    } else if (Array.isArray(field)) {
      for (const p of field) {
        if (typeof p !== "string" || !repositoryPath(p))
          throw new Error("unsupported pending paths");
        paths.add(p);
      }
    } else if (field !== undefined) throw new Error("unsupported pending changes");
  }
  const at = typeof v.lastIndexed === "string" ? Date.parse(v.lastIndexed) : NaN;
  return {
    ...base,
    state: unknown || paths.size ? "pending" : "ready",
    pending: unknown ? null : paths,
    commands: unknown || paths.size ? [`codegraph sync ${quote(root)}`] : [],
    ...(Number.isFinite(at) ? { lastIndexed: at } : {}),
  };
}
export function decodeMap(value: unknown, path: string): Omit<SymbolMap, "end">[] {
  const v = record(value);
  if (v.isError !== false || typeof v.output !== "string" || v.query !== path)
    throw new Error("unsupported symbol map");
  const result: Array<Omit<SymbolMap, "end">> = [];
  for (const line of v.output.split("\n")) {
    const match = /^- `([^`]+)` \([^)]*\)(.*?) — :(\d+)$/.exec(line);
    if (match) {
      const name = match[1]!,
        start = Number(match[3]);
      if (!symbolName(name) || start < 1) throw new Error("invalid symbol");
      result.push({ name, path, start, signature: match[2]!.trim() });
    }
  }
  const total = /(\d+) symbols?\b/.exec(v.output);
  if (!total || Number(total[1]) !== result.length || result.length > 40)
    throw new Error("truncated symbol map");
  return result;
}
const Node = Schema.Struct({
  name: Schema.String,
  filePath: Schema.String,
  startLine: Schema.Number,
  endLine: Schema.Number,
  signature: Schema.NullOr(Schema.String),
});
const readSearch = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ node: Node }))),
  readCallees = Schema.decodeUnknownSync(
    Schema.Struct({
      callees: Schema.Array(Schema.Struct({ name: Schema.String, filePath: Schema.String })),
    }),
  );
export function decodeSearch(value: unknown, symbol: Omit<SymbolMap, "end">): SymbolMap {
  const matches = readSearch(value);
  const exact = matches.filter(
    (v) =>
      v.node.name === symbol.name &&
      v.node.filePath === symbol.path &&
      v.node.startLine === symbol.start,
  );
  if (matches.length >= 20 || exact.length !== 1)
    throw new Error("ambiguous or truncated symbol search");
  const n = exact[0]!.node;
  if (!Number.isInteger(n.endLine) || n.endLine < n.startLine)
    throw new Error("invalid symbol range");
  return { ...symbol, end: n.endLine, signature: n.signature ?? symbol.signature };
}
export function decodeCallees(value: unknown): { name: string; path: string }[] {
  const v = readCallees(value);
  return v.callees
    .slice(0, 20)
    .filter((s) => symbolName(s.name) && repositoryPath(s.filePath))
    .map((s) => ({ name: s.name, path: s.filePath }));
}
export function createCodeGraph(
  options: { binary?: string | null; run?: Runner; timeoutMs?: number } = {},
) {
  const plans = new Map<
      string,
      { root: string; epoch: number; names: Omit<SymbolMap, "end">[]; done: SymbolMap[] }
    >(),
    times = new Map<string, number>();
  const binary = options.binary ?? process.env.PEER_CODEGRAPH_BIN ?? commandPath("codegraph"),
    run = options.run ?? runProcess,
    healths = new Map<string, { value: Health; until: number }>(),
    bad = new Map<string, { count: number; until: number }>();
  const command = async (root: string, args: ReadonlyArray<string>, signal?: AbortSignal) => {
    if (!binary) throw new Error("codegraph missing");
    return JSON.parse(
      await run(binary, args, root, {
        timeoutMs: options.timeoutMs ?? 2_000,
        cap: 1024 * 1024,
        signal,
      }),
    ) as unknown;
  };
  const health = async (root: string, now: number, signal?: AbortSignal): Promise<Health> => {
    times.set(root, now);
    const cached = healths.get(root),
      failure = bad.get(root);
    if (failure && failure.until > now)
      return { root, state: "failed", commands: [], pending: null };
    if (cached && cached.until > now) return cached.value;
    if (!binary)
      return {
        root,
        state: "missing",
        commands: ["Install CodeGraph 0.50 or newer"],
        pending: null,
      };
    try {
      const value = decodeHealth(root, await command(root, ["status", root, "--json"], signal));
      healths.set(root, { value, until: now + (value.state === "ready" ? 20_000 : 60_000) });
      bad.delete(root);
      return value;
    } catch (error) {
      if (error instanceof BudgetExceeded || signal?.aborted) throw error;
      const count = (failure?.count ?? 0) + 1;
      bad.set(root, { count, until: count >= 3 ? now + 600_000 : 0 });
      const value: Health = { root, state: "failed", commands: [], pending: null };
      healths.set(root, { value, until: now + 60_000 });
      return value;
    }
  };
  const attempt = async <A>(
    root: string,
    signal: AbortSignal | undefined,
    read: () => Promise<A>,
  ) => {
    try {
      const value = await read();
      bad.delete(root);
      return value;
    } catch (error) {
      if (!(error instanceof BudgetExceeded) && !signal?.aborted) {
        const count = (bad.get(root)?.count ?? 0) + 1;
        bad.set(root, { count, until: count >= 3 ? (times.get(root) ?? 0) + 600_000 : 0 });
      }
      throw error;
    }
  };
  return {
    health,
    forget: (roots: Set<string>) => {
      for (const root of healths.keys())
        if (!roots.has(root)) {
          healths.delete(root);
          bad.delete(root);
          times.delete(root);
        }
      for (const [key, plan] of plans) if (!roots.has(plan.root)) plans.delete(key);
    },
    failures: (root: string) => bad.get(root)?.count ?? 0,
    symbols: async (root: string, path: string, signal?: AbortSignal) =>
      attempt(root, signal, async () => {
        if (!repositoryPath(path)) throw new Error("invalid file");
        const key = `${root}\0${path}`,
          epoch = healths.get(root)?.value.lastIndexed ?? 0;
        let plan = plans.get(key);
        if (!plan || plan.epoch !== epoch) {
          const names = decodeMap(
            await command(root, ["node", path, "-p", root, "--symbols-only", "--json"], signal),
            path,
          );
          plan = { root, epoch, names, done: [] };
          plans.set(key, plan);
          while (plans.size > 64) plans.delete(plans.keys().next().value!);
        }
        for (const symbol of plan.names.slice(plan.done.length))
          plan.done.push(
            decodeSearch(
              await command(
                root,
                ["search", symbol.name, "-p", root, "--json", "--limit", "20"],
                signal,
              ),
              symbol,
            ),
          );
        return plan.done;
      }),
    callees: async (root: string, symbol: SymbolMap, signal?: AbortSignal) =>
      attempt(root, signal, async () =>
        decodeCallees(
          await command(
            root,
            ["callees", symbol.name, "-p", root, "--file", symbol.path, "--json", "--limit", "20"],
            signal,
          ),
        ),
      ),
  };
}
