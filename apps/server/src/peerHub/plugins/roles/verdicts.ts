/**
 * What a review session may not do (design D3): a structured edit of a repository file (Edit,
 * Write, MultiEdit, NotebookEdit, `apply_patch` and their kin: any call with `paths`), a shell
 * command that lands work (`isLanding`, jj forms included), and the plain shell forms of a write
 * (`shellWrite`), stopped before they run. A script can still write in its own worktree; what lands
 * from there stays denied. The role comes from memory, so the
 * budget a verdict has never changes its outcome: the fallback is this same function. Peer's own
 * files never reach a plugin's verdict, so its working context stays writable.
 *
 * @module peerHub/plugins/roles/verdicts
 */
import {
  landingKind,
  shellWrite,
  type PeerToolContext,
  type PeerVerdict,
} from "../../core/plugin.ts";
import { editStop, landingStop, shellStop } from "./text.ts";

/** A stop of a review session, and where it was. */
export interface Stop {
  readonly verdict: PeerVerdict;
  readonly where: "edit" | "landing";
}

/** The stop for a tool call of a session with `role`, or null when none is due. */
export function judge(role: string | undefined, ctx: PeerToolContext): Stop | null {
  if (role !== "review") return null;
  if (ctx.tool === "Bash") {
    if (ctx.command === undefined) return null;
    const kind = landingKind(ctx.command);
    if (kind !== undefined)
      return { where: "landing", verdict: { decision: "deny", reason: landingStop(kind) } };
    const write = shellWrite(ctx.command);
    return write === undefined
      ? null
      : { where: "edit", verdict: { decision: "deny", reason: shellStop(write) } };
  }
  return ctx.paths.length === 0
    ? null
    : { where: "edit", verdict: { decision: "deny", reason: editStop(ctx.paths) } };
}
