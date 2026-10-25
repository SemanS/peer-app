// @effect-diagnostics nodeBuiltinImport:off - local repository identity is canonical across worktrees.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { PEER_LOCAL_WORKSPACE } from "@t3tools/contracts";
import type { CheckoutPlace } from "../broker/host.ts";
import { run } from "../local.ts";
import { checkoutKind } from "../vcs.ts";

const canonical = (path: string) => NodeFSP.realpath(path).catch(() => NodePath.resolve(path));

async function repository(cwd: string) {
  const kind = await checkoutKind(cwd);
  if (kind?.kind === "jj-unsupported") return null;
  if (kind?.kind === "jj")
    return { root: await canonical(kind.root), identity: await canonical(kind.gitDir) };
  const root = await run("git", ["-C", cwd, "rev-parse", "--show-toplevel"]).catch(() => null);
  if (root === null || root === "") return null;
  const common = await run("git", [
    "-C",
    cwd,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  return { root: await canonical(root), identity: await canonical(common) };
}

/** Only repositories explicitly opened in this environment can enroll local agents. */
export async function localPlace(
  cwd: string,
  openedRoots: readonly string[],
): Promise<CheckoutPlace | null> {
  const target = await repository(cwd);
  if (target === null) return null;
  const opened = await Promise.all(openedRoots.map(repository));
  if (!opened.some((repo) => repo?.identity === target.identity)) return null;
  return {
    workspace: PEER_LOCAL_WORKSPACE,
    project: `local-${NodeCrypto.createHash("sha256").update(target.identity).digest("hex").slice(0, 24)}`,
    root: target.root,
  };
}
