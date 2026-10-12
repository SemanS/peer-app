/**
 * What an agent may not do in paths another person owns and decides, until that person's call says
 * so: an edit (design D9) and a step that lands work (D12), which also stops a change made through
 * the shell, where no edit hook looks. Both go by what the Hub last said (`Standing`), from memory,
 * so the budget a verdict has never changes its outcome: the fallback is the same function. It is a
 * deny, never an ask, since an ask would prompt the agent's own person, the wrong one to answer.
 *
 * @module peerHub/plugins/ownership/verdicts
 */
import {
  isLanding,
  landingKind,
  type PeerToolContext,
  type PeerVerdict,
} from "../../core/plugin.ts";
import { waitingOn } from "./client/rules.ts";
import type { Standing } from "./Ownership.ts";
import { editStop, landingStop } from "./text.ts";

/** A step that waits for an owner's call, and what stops it. */
export interface Stop {
  readonly verdict: PeerVerdict;
  readonly where: "edit" | "landing";
}

/**
 * The stop for a tool call, or null when none is due: an edit of paths that wait for an owner's
 * call, or a landing step in the shell while the session's reported changes include such paths. The
 * first owner's paths are named; asking them, the agent meets the next owner's at its next try.
 */
export function judge(
  standing: Standing | undefined,
  name: (email: string) => string,
  ctx: PeerToolContext,
): Stop | null {
  if (standing === undefined) return null;
  const command = ctx.tool === "Bash" ? ctx.command : undefined;
  const landing = command !== undefined && isLanding(command);
  const { person, environment, project } = standing;
  const me = { id: ctx.session.id, email: person, environment, task: ctx.session.task };
  const [first] = waitingOn(project, me, landing ? ctx.session.files : ctx.paths);
  if (first === undefined) return null;
  const [owner, paths] = first;
  return landing
    ? {
        where: "landing",
        verdict: {
          decision: "deny",
          reason: landingStop(landingKind(command) ?? "step", name(owner), paths),
        },
      }
    : {
        where: "edit",
        verdict: { decision: "deny", reason: editStop(name(owner), paths) },
      };
}
