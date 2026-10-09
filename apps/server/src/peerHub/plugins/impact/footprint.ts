// @effect-diagnostics nodeBuiltinImport:off - hashes remain in local memory and never enter reports.
import * as NodeCrypto from "node:crypto";
import type { PeerImpactFootprint, PeerImpactChange } from "@t3tools/contracts";
import { repositoryPath, type SymbolMap } from "./client/codegraph.ts";
import type { ChangedFile } from "./client/diff.ts";
export const severity = (change: PeerImpactChange) =>
  ({ body: 0, signature: 1, removed: 2 })[change];
export type FootprintState = {
  indexMaps: Map<string, { epoch: number; symbols: SymbolMap[] }>;
  maps: Map<string, SymbolMap[]>;
  revisions: Map<string, { hash: string; rev: number; uses: { name: string; path: string }[] }>;
};
export const newFootprintState = (): FootprintState => ({
  indexMaps: new Map(),
  maps: new Map(),
  revisions: new Map(),
});
export async function computeFootprint(input: {
  session: string;
  project: string;
  files: Map<string, ChangedFile>;
  state: FootprintState;
  symbols: (path: string) => Promise<SymbolMap[]>;
  callees: (symbol: SymbolMap) => Promise<{ name: string; path: string }[]>;
  provided: ReadonlyArray<{ name: string; path?: string }>;
}): Promise<PeerImpactFootprint> {
  const changed: Array<PeerImpactFootprint["changed"][number]> = [],
    uses: Array<PeerImpactFootprint["uses"][number]> = [];
  for (const [path, file] of [...input.files].toReversed()) {
    const symbols = await input.symbols(path),
      kinds = new Map<SymbolMap, PeerImpactChange>(),
      lines = file.text.split("\n");
    if (file.newFile) for (const s of symbols) kinds.set(s, "signature");
    else
      for (const h of file.hunks)
        for (let line = h.start; line <= Math.min(h.end, lines.length); line++) {
          const s = symbols
            .filter((s) => s.start <= line && s.end >= line)
            .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
          if (!s) continue;
          const kind =
              line <= s.start + Math.max(0, s.signature.split("\n").length - 1)
                ? "signature"
                : "body",
            previous = kinds.get(s);
          if (previous === undefined || severity(kind) > severity(previous)) kinds.set(s, kind);
        }
    if (file.text.trim() && symbols.length)
      for (const old of input.state.maps.get(path) ?? [])
        if (!symbols.some((s) => s.name === old.name)) kinds.set(old, "removed");
    for (const [s, change] of kinds) {
      if (changed.length >= 40) break;
      const key = `${path}\0${s.name}`,
        hash = NodeCrypto.createHash("sha256")
          .update(change === "removed" ? "removed" : lines.slice(s.start - 1, s.end).join("\n"))
          .digest("hex"),
        previous = input.state.revisions.get(key);
      const rev = previous === undefined ? 1 : previous.rev + (previous.hash === hash ? 0 : 1),
        calls =
          change === "removed"
            ? []
            : previous?.hash === hash
              ? previous.uses
              : await input.callees(s);
      const safe = calls.filter((c) => repositoryPath(c.path)).slice(0, 20);
      input.state.revisions.set(key, { hash, rev, uses: safe });
      changed.push({
        name: s.name,
        path,
        change,
        rev,
        provided: input.provided.some(
          (p) => p.name === s.name && (p.path === undefined || p.path === path),
        ),
      });
      for (const call of safe)
        if (
          uses.length < 120 &&
          !uses.some(
            (v) =>
              v.name === call.name &&
              v.path === call.path &&
              v.from === s.name &&
              v.fromPath === path,
          )
        )
          uses.push({ ...call, from: s.name, fromPath: path });
    }
    // Remember removed symbols while this file stays in the changed set.
    input.state.maps.set(path, [
      ...symbols,
      ...(input.state.maps.get(path) ?? []).filter(
        (old) => !symbols.some((s) => s.name === old.name),
      ),
    ]);
  }
  return { session: input.session, project: input.project, changed, uses };
}
