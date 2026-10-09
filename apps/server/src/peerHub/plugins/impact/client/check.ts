import type { PeerImpactFootprint } from "@t3tools/contracts";
import { computeFootprint, type FootprintState } from "../footprint.ts";
import { BudgetExceeded } from "../scheduler.ts";
import type { ProvidedEntry } from "../provides.ts";
import type { createCodeGraph, Health } from "./codegraph.ts";
import type { createDiff } from "./diff.ts";
/** Only this boundary reads local source and invokes CodeGraph/Git; its result is a wire projection. */
export async function checkSession(
  input: {
    id: string;
    project: string;
    root: string;
    files: ReadonlyArray<string>;
    branch: string;
    provided: ReadonlyArray<ProvidedEntry>;
    state: FootprintState;
    now: number;
  },
  graph: ReturnType<typeof createCodeGraph>,
  diff: ReturnType<typeof createDiff>,
  signal: AbortSignal,
): Promise<{ health: Health; footprint: PeerImpactFootprint }> {
  const health = await graph.health(input.root, input.now, signal);
  if (health.state !== "ready" && health.state !== "pending")
    return {
      health,
      footprint: { session: input.id, project: input.project, changed: [], uses: [] },
    };
  const source = await diff.read(input.root, input.files, input.branch, signal);
  if (source === null) throw new BudgetExceeded();
  for (const file of source.files.keys())
    if (health.pending === null || health.pending.has(file)) source.files.delete(file);
  const epoch = health.lastIndexed ?? 0;
  for (const map of [input.state.maps, input.state.indexMaps])
    for (const path of map.keys()) if (!input.files.includes(path)) map.delete(path);
  for (const key of input.state.revisions.keys())
    if (!input.files.includes(key.split("\0")[0]!)) input.state.revisions.delete(key);
  const footprint = await computeFootprint({
    session: input.id,
    project: input.project,
    files: source.files,
    state: input.state,
    symbols: async (path) => {
      const cached = input.state.indexMaps.get(path);
      if (cached?.epoch === epoch) return cached.symbols;
      const symbols = await graph.symbols(input.root, path, signal);
      input.state.indexMaps.set(path, { epoch, symbols });
      return symbols;
    },
    callees: (symbol) => graph.callees(input.root, symbol, signal),
    provided: input.provided,
  });
  if (signal.aborted) throw new BudgetExceeded();
  return { health, footprint };
}
