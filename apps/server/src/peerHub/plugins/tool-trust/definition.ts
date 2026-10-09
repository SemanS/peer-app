// @effect-diagnostics preferSchemaOverJson:off - frozen canonical JSON fingerprint protocol.
// @effect-diagnostics nodeBuiltinImport:off - fingerprints use the synchronous SHA-256 injection path.
import { createHash } from "node:crypto";
import type { PeerMcpServer, PeerTool } from "@t3tools/contracts";
import { safeId } from "../../core/state/PeerState.ts";

export type Definition =
  | readonly ["stdio", string, ReadonlyArray<string>, ReadonlyArray<readonly [string, string]>]
  | readonly ["http" | "sse", string, ReadonlyArray<readonly [string, string]>];
export const validSecretName = (name: string) => /^[A-Z_][A-Z0-9_]{0,63}$/.test(name);
export const validSecretValue = (value: string | undefined): value is string =>
  value !== undefined && value.length > 0 && value.length <= 8192 && !/[\r\n\0]/.test(value);
const pairs = (entries: Readonly<Record<string, string>>) =>
  Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
export function secretReferences(value: string): { names: ReadonlyArray<string>; reason?: string } {
  const names = new Set<string>();
  let reason: string | undefined;
  for (const match of value.matchAll(/\$\{secret:([^}]*)(\}|$)/g)) {
    if (match[2] !== "}" || !validSecretName(match[1]!))
      reason = "Secret reference must be closed and name [A-Z_][A-Z0-9_]{0,63}.";
    else names.add(match[1]!);
  }
  return { names: [...names].sort(), ...(reason === undefined ? {} : { reason }) };
}
export function definition(tool: PeerTool) {
  const mcp = tool.mcp;
  const canonical: Definition =
    mcp.transport === "stdio"
      ? ["stdio", mcp.command, [...mcp.args], pairs(mcp.env)]
      : [mcp.transport, mcp.url, pairs(mcp.headers)];
  const values =
    mcp.transport === "stdio"
      ? [mcp.command, ...mcp.args, ...Object.values(mcp.env)]
      : [mcp.url, ...Object.values(mcp.headers)];
  const refs = values.map(secretReferences);
  const reason = !safeId(tool.id)
    ? "Tool id must be lowercase kebab-case."
    : refs.find((ref) => ref.reason !== undefined)?.reason;
  return {
    canonical,
    fingerprint: `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`,
    names: [...new Set(refs.flatMap((ref) => ref.names))].sort(),
    ...(reason === undefined ? {} : { reason }),
  };
}
export type CheckedDefinition = ReturnType<typeof definition>;
const memo = new WeakMap<
  PeerMcpServer,
  Omit<CheckedDefinition, "reason"> & { readonly reason?: string }
>();
export function checkedDefinition(tool: PeerTool): CheckedDefinition {
  let checked = memo.get(tool.mcp);
  if (checked === undefined) {
    checked = definition({ ...tool, id: "valid" });
    memo.set(tool.mcp, checked);
  }
  return safeId(tool.id)
    ? checked
    : { ...checked, reason: "Tool id must be lowercase kebab-case." };
}
export function changes(before: Definition, after: Definition): ReadonlyArray<string> {
  if (before[0] !== after[0]) return ["transport"];
  const out: string[] = [];
  if (before[1] !== after[1]) out.push(after[0] === "stdio" ? "command" : "URL");
  if (
    before[0] === "stdio" &&
    after[0] === "stdio" &&
    JSON.stringify(before[2]) !== JSON.stringify(after[2])
  )
    out.push("arguments");
  const a = new Map(before[0] === "stdio" ? before[3] : before[2]);
  const b = new Map(after[0] === "stdio" ? after[3] : after[2]);
  for (const name of [...new Set([...a.keys(), ...b.keys()])].sort())
    if (a.get(name) !== b.get(name)) out.push(`${after[0] === "stdio" ? "env" : "header"} ${name}`);
  return out;
}
