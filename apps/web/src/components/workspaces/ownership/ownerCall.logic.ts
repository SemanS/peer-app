/**
 * How an owner's call reads: when it ends, which paths it names and who decides them, and, for the
 * pill on a task's page, what the person looking may do with it (the client runtime's
 * `callActions`, as the Hub decides it). Pure, with `now` passed in.
 */
import {
  callActions,
  ownerDecides,
  ownerName,
  pathOwner,
  type CallActions,
  type ProjectOwnership,
} from "@t3tools/client-runtime/peer/ownership";
import type { PeerOwnerCall } from "@t3tools/contracts";

import { agoLabel } from "../task/taskTime.logic";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "expires in 6 days", "expires in 5 h", "expires in 20 min", "expired"; undefined for a bad date. */
export function expiresLabel(expiresAt: string, now: number): string | undefined {
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return undefined;
  const left = at - now;
  if (left <= 0) return "expired";
  const days = Math.floor(left / DAY_MS);
  if (days >= 1) return `expires in ${days} ${days === 1 ? "day" : "days"}`;
  const hours = Math.floor(left / HOUR_MS);
  if (hours >= 1) return `expires in ${hours} h`;
  return `expires in ${Math.max(1, Math.floor(left / MINUTE_MS))} min`;
}

/** "src/payments/fees.ts", "a.ts and b.ts", "a.ts, b.ts and 3 more". */
export function pathsText(paths: ReadonlyArray<string>): string {
  if (paths.length <= 2) return paths.join(" and ");
  return `${paths[0]}, ${paths[1]} and ${paths.length - 2} more`;
}

/** What the popover of a pending call says. */
export interface CallDetails {
  /** "Your agent asked Ana to change a path they decide". */
  readonly title: string;
  /** Each path with who decides it and by which pattern: "Ana decides changes by others in src/payments/**". */
  readonly paths: ReadonlyArray<{ readonly path: string; readonly rule: string | undefined }>;
  readonly reason: string;
  /** "Asked 40 min ago · expires in 6 days". */
  readonly meta: string;
  readonly actions: CallActions;
  /** What the buttons that decide it say: "Accept…", or "Accept for Ana…" for a lead; undefined where they may not. */
  readonly decisions: { readonly accept: string; readonly decline: string } | undefined;
}

/** The details of a pending call for the person looking at the task it is about. */
export function callDetails(
  ownership: ProjectOwnership,
  call: PeerOwnerCall,
  now: number,
): CallDetails {
  const actions = callActions(ownership, call, now);
  const mine = call.email === ownership.me;
  const asker = mine ? "Your agent" : `${ownerName(ownership, call.email)}'s agent`;
  const owner = ownerName(ownership, call.owner);
  const asked = agoLabel(call.createdAt, now);
  const expires = expiresLabel(call.expiresAt, now);
  return {
    title:
      call.owner === ownership.me
        ? `${asker} asks you to change a path you decide`
        : `${asker} asked ${owner} to change a path they decide`,
    paths: call.paths.map((path) => {
      const found = pathOwner(ownership.view.map, path, ownership.people);
      return {
        path,
        rule:
          found === undefined || !ownerDecides(ownership.view.map, path)
            ? undefined
            : `${ownerName(ownership, found.owner)} decides changes by others in ${found.pattern}`,
      };
    }),
    reason: `Reason from ${mine ? "your agent" : asker}: “${call.reason}”`,
    meta: [asked === "" ? undefined : `Asked ${asked}`, expires]
      .filter((part) => part !== undefined)
      .join(" · "),
    actions,
    decisions:
      actions.decide === undefined
        ? undefined
        : actions.decide === "owner"
          ? { accept: "Accept…", decline: "Decline…" }
          : { accept: `Accept for ${owner}…`, decline: `Decline for ${owner}…` },
  };
}
