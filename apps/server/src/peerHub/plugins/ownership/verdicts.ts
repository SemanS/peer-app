/**
 * What an agent may not do in paths another person owns and decides, until that person's call says
 * so: an edit (design D9) and a step that lands work (D12: `git commit`, `git push`, `gh pr create`,
 * `gh pr merge`), which also stops a change made through the shell, where no edit hook looks. Both
 * go by what the Hub last said (`Standing`), from memory, so the budget a verdict has never changes
 * its outcome: the fallback is the same function. It is a deny, never an ask, since an ask would
 * prompt the agent's own person, who is the wrong one to answer. The owner's own agents are never
 * stopped, nor is anything outside the paths the project's leads marked.
 *
 * @module peerHub/plugins/ownership/verdicts
 */
import {
  isLanding,
  landingKind,
  type PeerToolContext,
  type PeerVerdict,
} from "../../core/plugin.ts";
import type { Standing } from "./Ownership.ts";
import { about, covers, generated, names, ownerToAsk } from "./client/rules.ts";
import { editStop, landingStop } from "./text.ts";

/** A step that waits for an owner's call, and what stops it. */
export interface Stop {
  readonly verdict: PeerVerdict;
  readonly where: "edit" | "landing";
}

/**
 * The paths that need an owner's call the session has not got, by owner in the order the paths
 * come: a path where the owner decides, that somebody else owns, and that no accepted call of the
 * session's task (or of the session itself, with no task) names.
 */
export function waitingOn(
  standing: Standing,
  session: { readonly id: string; readonly task: string | undefined },
  paths: ReadonlyArray<string>,
): ReadonlyMap<string, ReadonlyArray<string>> {
  const { person, environment, project } = standing;
  const me = { id: session.id, email: person, environment, task: session.task };
  const by = new Map<string, string[]>();
  for (const path of new Set(paths)) {
    const owner = generated(path) ? undefined : ownerToAsk(project.map, person, path);
    if (owner === undefined || project.calls.some((call) => covers(call, me, path))) continue;
    by.set(owner, [...(by.get(owner) ?? []), path]);
  }
  return by;
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
  const [first] = waitingOn(standing, ctx.session, landing ? ctx.session.files : ctx.paths);
  if (first === undefined) return null;
  const [owner, paths] = first;
  const { person, environment, project } = standing;
  const me = { id: ctx.session.id, email: person, environment, task: ctx.session.task };
  // Its call already waits for the owner: it is told so, and not to ask again.
  const pending = project.calls.find(
    (call) =>
      call.state === "pending" &&
      call.owner === owner &&
      about(call, me) &&
      paths.every((path) => names(call, path)),
  )?.id;
  const who = name(owner);
  return landing
    ? {
        where: "landing",
        verdict: {
          decision: "deny",
          reason: landingStop(landingKind(command) ?? "step", who, paths, pending),
        },
      }
    : { where: "edit", verdict: { decision: "deny", reason: editStop(who, paths, pending) } };
}
