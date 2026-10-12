/**
 * Who answers for what, from the Hub's view of a project: the rules the verdicts, notices and
 * commands of this plugin need. The Hub decides all of this (`server/src/features/ownership`) and the
 * client runtime mirrors it for display (`packages/client-runtime/src/peer/ownershipRules.ts`), which
 * this plugin cannot import: this is the server's twin, and `rules.test.ts` runs it on the cases of
 * the fixture all three share (`ownership.fixtures.json`). Change a rule, change the fixture and
 * every side.
 *
 * @module peerHub/plugins/ownership/rules
 */
import type { PeerOwnerMap } from "@t3tools/contracts";

/** The people on a project now. */
export interface Members {
  readonly has: (email: string) => boolean;
}

/**
 * A task's effective owner: the owner of its own row while they are on the project, else the owner
 * its area has in the map while they are; nobody when neither is. An owner who left owns nothing, so
 * what they owned falls back as if it had no owner.
 */
export function effectiveOwner(
  task: { readonly area?: string | undefined },
  row: { readonly owner: string } | undefined,
  map: Pick<PeerOwnerMap, "areas">,
  members: Members,
): { readonly owner: string; readonly throughArea: boolean } | undefined {
  if (row !== undefined && members.has(row.owner)) return { owner: row.owner, throughArea: false };
  if (task.area === undefined || !Object.hasOwn(map.areas, task.area)) return undefined;
  const owner = map.areas[task.area];
  return owner !== undefined && members.has(owner) ? { owner, throughArea: true } : undefined;
}
