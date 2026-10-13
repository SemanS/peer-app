import type { PeerPlanItem, PeerPlanProvides } from "@t3tools/contracts";
import { NAME_CHARS, repositoryPath, validName } from "./client/rules.ts";

/** Why an input is no plan, and what to run instead when the form alone does not say. */
export interface Bad {
  readonly reason: string;
  readonly next?: string;
}

/** `<path>`, `<dir>/` or `<path>#<symbol>`: the symbol is whatever follows the first `#`. */
export function parseItem(root: string, raw: string): { item: PeerPlanItem } | Bad {
  const at = raw.indexOf("#");
  const spelled = at < 0 ? raw : raw.slice(0, at);
  const path = repositoryPath(root, spelled);
  if (path === null)
    return { reason: `${spelled.trim() || "an empty path"} is outside the repository` };
  if (at < 0) return { item: { path } };
  const name = raw.slice(at + 1).trim();
  if (path.endsWith("/")) return { reason: `${path} is a directory, which names no symbol` };
  if (!validName(name))
    return { reason: `${raw.trim()} needs a symbol of 1 to ${NAME_CHARS} characters after the #` };
  return { item: { path, name } };
}

/**
 * `<symbol> (<path>): <contract>`: a `## Provides` bullet without its dash, the symbol with or
 * without backticks. The path is a file; the contract is whatever follows the colon.
 */
export function parseProvides(root: string, raw: string): { provides: PeerPlanProvides } | Bad {
  const match = /^\s*(?:-\s+)?`?([^\s`()]+)`?\s*\((.+?)\)\s*:\s*(\S.*)$/s.exec(raw);
  if (match === null)
    return {
      reason: 'a contract names its path: "<symbol> (<path>): <contract>"',
      next: 'pass --provides "Fee.refundCents (src/payments/fees.ts): integer cents"',
    };
  const [, name = "", spelled = "", contract = ""] = match;
  const path = repositoryPath(root, spelled);
  if (path === null) return { reason: `${spelled.trim()} is outside the repository` };
  if (path.endsWith("/")) return { reason: `${path} is a directory: a contract names a file` };
  if (!validName(name))
    return { reason: `${name} is not a symbol of 1 to ${NAME_CHARS} characters` };
  return { provides: { name, path, contract: contract.trim() } };
}
