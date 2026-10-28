/**
 * What a review session may not do (design D3): a structured edit of a repository file (Edit,
 * Write, MultiEdit, NotebookEdit, `apply_patch` and their kin: any call with `paths`) and a shell
 * command that lands work (`isLanding`, jj forms included). The role comes from memory, so the
 * budget a verdict has never changes its outcome: the fallback is this same function. Peer's own
 * files never reach a plugin's verdict, so its working context stays writable.
 *
 * @module peerHub/plugins/roles/verdicts
 */
import { landingKind, type PeerToolContext, type PeerVerdict } from "../../core/plugin.ts";
import { editStop, landingStop } from "./text.ts";

/** A stop of a review session, and where it was. */
export interface Stop {
  readonly verdict: PeerVerdict;
  readonly where: "edit" | "landing";
}

/** The stop for a tool call of a session with `role`, or null when none is due. */
export function judge(role: string | undefined, ctx: PeerToolContext): Stop | null {
  if (role !== "review") return null;
  if (ctx.tool === "Bash") {
    const kind = ctx.command === undefined ? undefined : landingKind(ctx.command);
    return kind === undefined
      ? null
      : { where: "landing", verdict: { decision: "deny", reason: landingStop(kind) } };
  }
  return ctx.paths.length === 0
    ? null
    : { where: "edit", verdict: { decision: "deny", reason: editStop(ctx.paths) } };
}
