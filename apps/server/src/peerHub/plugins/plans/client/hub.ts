import {
  PeerPlanDeclared,
  PeerPlansView,
  PeerPlanWithdrawn,
  type PeerPlanDeclaration,
  type PeerPlanItem,
  type PeerPlanMode,
  type PeerPlanProvides,
  type PeerPlanWithdrawal,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { PeerHubClient } from "../../../core/hub/PeerHubClient.ts";
import { CliError, refused } from "../../../core/plugin.ts";

/** What a plan names: the items it changes, may change and uses, and the contracts it provides. */
export interface Items {
  readonly changes: ReadonlyArray<PeerPlanItem>;
  readonly maybes: ReadonlyArray<PeerPlanItem>;
  readonly uses: ReadonlyArray<PeerPlanItem>;
  readonly provides: ReadonlyArray<PeerPlanProvides>;
}

/** What a declaration holds: how it meets the stored plan, and the items. */
export interface Declaration {
  readonly mode: PeerPlanMode;
  readonly items: Items;
}

/** A declaration waiting for the Hub: when it is sent next (epoch ms), and how often it was sent again. */
export interface Pending extends Declaration {
  readonly workspace: string;
  readonly project: string;
  readonly seq: number;
  readonly due: number;
  readonly tries: number;
}

/** Ten seconds apart at first, then a minute. */
const retryIn = (tries: number) => (tries < 6 ? 10_000 : 60_000);

/**
 * A newer declaration while an older one waits, as the one to send: a replacement stands alone, and
 * an amendment adds to the waiting declaration, so nothing the agent declared is lost.
 */
export function combine(older: Declaration | undefined, newer: Declaration): Declaration {
  if (older === undefined || newer.mode === "replace") return newer;
  const join = <T>(first: ReadonlyArray<T>, second: ReadonlyArray<T>) => [...first, ...second];
  return {
    mode: older.mode,
    items: {
      changes: join(older.items.changes, newer.items.changes),
      maybes: join(older.items.maybes, newer.items.maybes),
      uses: join(older.items.uses, newer.items.uses),
      provides: join(older.items.provides, newer.items.provides),
    },
  };
}

export const bodyOf = (
  environment: string,
  session: string,
  seq: number,
  { mode, items }: Declaration,
): PeerPlanDeclaration => ({ environment, session, seq, mode, ...items });

/**
 * The declarations the Hub has not answered, one per session, and the `seq` each goes with: its
 * time in milliseconds, which the Hub refuses when older than the stored plan's. A late resend
 * therefore never replaces a newer plan, and the same one again changes nothing.
 */
export function createOutbox() {
  const waiting = new Map<string, Pending>();
  const seqs = new Map<string, number>();
  return {
    /** What to send for a declaration now: it with what waits, and its `seq`, never one used before. */
    prepare(session: string, now: number, declaration: Declaration) {
      const seq = Math.max(now, (seqs.get(session) ?? 0) + 1);
      seqs.set(session, seq);
      return { seq, declaration: combine(waiting.get(session), declaration) };
    },
    hold(
      session: string,
      sent: Declaration & { workspace: string; project: string; seq: number },
      now: number,
    ) {
      waiting.set(session, { ...sent, due: now + retryIn(0), tries: 0 });
    },
    /** Forgets a session's waiting declaration; whether there was one. */
    drop: (session: string) => waiting.delete(session),
    /** Forgets the declarations of a workspace, or of every one. */
    purge(workspace?: string) {
      for (const [session, one] of waiting)
        if (workspace === undefined || one.workspace === workspace) waiting.delete(session);
    },
    /** The declarations due at `now`, those of sessions that ended forgotten. */
    due(now: number, live: ReadonlySet<string>) {
      const due: Array<readonly [string, Pending]> = [];
      for (const [session, one] of waiting)
        if (!live.has(session)) waiting.delete(session);
        else if (one.due <= now) due.push([session, one]);
      return due;
    },
    /** One did not get through again. */
    later(session: string, one: Pending, now: number) {
      waiting.set(session, { ...one, tries: one.tries + 1, due: now + retryIn(one.tries + 1) });
    },
  };
}

/** What the command says when the Hub did not answer a declaration (it waits and is sent again), has no plans, or holds a newer one. */
export const SILENT = new CliError(
  "uncertain",
  "the Hub did not answer; Peer sends this plan again when it answers and records it once",
  "peer plan",
);
export const OLDER = refused(
  "plans need a newer Peer Hub; nothing was recorded",
  "ask a workspace admin to update the Hub",
);
export const STALE = refused(
  "a newer declaration of this plan is stored, so this one was not applied",
  "peer plan shows the plan as it is.",
);

export type DeclareAnswer =
  | { readonly _tag: "recorded"; readonly declared: PeerPlanDeclared }
  /** The Hub has no route for plans. */
  | { readonly _tag: "unsupported" }
  /** The Hub holds a newer declaration of the session, with this seq. */
  | { readonly _tag: "stale"; readonly seq: number };

const seqOf = (details: unknown) =>
  typeof details === "object" &&
  details !== null &&
  "seq" in details &&
  typeof details.seq === "number"
    ? details.seq
    : 0;

/** The Hub's three endpoints; an answer of null is a Hub with no route for plans. */
export function plansHub(client: PeerHubClient["Service"]) {
  const missing = (_status: number, message: string) => message === "no such route";
  return {
    declare: (workspace: string, project: string, body: PeerPlanDeclaration) =>
      client
        .request<typeof PeerPlanDeclared, DeclareAnswer>(PeerPlanDeclared, {
          workspace,
          path: `/plans/${encodeURIComponent(project)}`,
          method: "PUT",
          body,
          timeoutMs: 8_000,
          unsupported: { value: { _tag: "unsupported" }, when: missing },
          conflict: (code, details) =>
            code === "stale_seq" ? { _tag: "stale", seq: seqOf(details) } : undefined,
        })
        .pipe(
          Effect.map((answer): DeclareAnswer =>
            "_tag" in answer ? answer : { _tag: "recorded", declared: answer },
          ),
        ),
    view: (workspace: string) =>
      client.request(PeerPlansView, {
        workspace,
        path: "/plans",
        unsupported: { value: null, when: missing },
      }),
    withdraw: (workspace: string, body: PeerPlanWithdrawal) =>
      client.request(PeerPlanWithdrawn, {
        workspace,
        path: "/plans/withdraw",
        method: "POST",
        body,
        unsupported: { value: null, when: missing },
      }),
  };
}
