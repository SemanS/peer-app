import {
  PeerPlanChallenged,
  PeerPlanDeclared,
  PeerPlansView,
  PeerPlanWithdrawn,
  type PeerHubError,
  type PeerPlanChallengeRequest,
  type PeerPlanDeclaration,
  type PeerPlanItem,
  type PeerPlanMode,
  type PeerPlanProvides,
  type PeerPlanWithdrawal,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { PeerHubClient } from "../../../core/hub/PeerHubClient.ts";
import { CliError, isSignedOut, refused, usage } from "../../../core/plugin.ts";
import { plain } from "../../../peerText.ts";
import { form } from "../text.ts";

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
      if (sent.seq !== seqs.get(session)) return;
      waiting.set(session, { ...sent, due: now + retryIn(0), tries: 0 });
    },
    /** Forgets a session's waiting declaration; whether there was one. */
    drop(session: string, seq?: number) {
      if (seq !== undefined && (waiting.get(session)?.seq ?? 0) > seq) return false;
      return waiting.delete(session);
    },
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
      if (waiting.get(session)?.seq !== one.seq) return;
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

/** What a challenge or a close ends with on a Hub whose plans are older than revision 2. */
export const LACKS_CHALLENGES = refused(
  "the Hub lacks plan challenges; nothing was recorded",
  "ask a workspace admin to update the Hub; plans keep working as before.",
);

/** The plans revision that serves challenges. */
const CHALLENGES_REVISION = 2;

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

/**
 * The Hub's endpoints; an answer of null is a Hub with no route for plans. Challenges need plans
 * revision 2, which the Hub's feature catalog says: the plugin itself runs from revision 1.
 */
export function plansHub(client: PeerHubClient["Service"]) {
  const missing = (_status: number, message: string) => message === "no such route";
  const challengesServed = Effect.map(
    client.features,
    (features) => (features.plans ?? 0) >= CHALLENGES_REVISION,
  );
  /**
   * Records or closes a challenge. No outbox and no seq: the Hub replaces a session's open challenge
   * of the same item and closes a closed one as a no-op, so sending one again is safe.
   */
  const challenges = (workspace: string, project: string, body: PeerPlanChallengeRequest) =>
    Effect.gen(function* () {
      if (!(yield* challengesServed)) return yield* Effect.fail(LACKS_CHALLENGES);
      const answer = yield* client.request(PeerPlanChallenged, {
        workspace,
        path: `/plans/${encodeURIComponent(project)}/challenges`,
        method: "POST",
        body,
        timeoutMs: 8_000,
        unsupported: { value: null, when: missing },
      });
      return answer ?? (yield* Effect.fail(LACKS_CHALLENGES));
    });
  return {
    challengesServed,
    challenge: (
      workspace: string,
      project: string,
      body: { readonly environment: string; readonly session: string } & Required<
        Pick<PeerPlanChallengeRequest, "item" | "reason">
      >,
    ) => challenges(workspace, project, body),
    closeChallenge: (
      workspace: string,
      project: string,
      body: { readonly environment: string; readonly session: string } & Required<
        Pick<PeerPlanChallengeRequest, "close">
      > &
        Pick<PeerPlanChallengeRequest, "note">,
    ) => challenges(workspace, project, body),
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

/** The form a usage error ends with, written after its `Next: `. */
export const FORM_NEXT = form(6);

type Failed = PeerHubError | CliError;

/** What a write said when the Hub did not answer: what may have taken effect, and what shows it. */
const WITHDRAW = {
  command: "peer plan --withdraw",
  check: "peer plan",
  next: "run peer plan to see the plan as it is.",
};
export const CHALLENGE = {
  command: "peer plan challenge",
  check: "peer plan challenge",
  next: "peer plan challenge lists the project's challenges.",
};

/**
 * A failed call to the Hub as `peer-cli-contract` has it: a 400 is usage, another 4xx refused, no
 * answer to a write uncertain; a read is only ever refused.
 */
export function hubOutcome(error: Failed, write: boolean, about = WITHDRAW) {
  if (error instanceof CliError) return error;
  const detail = plain(error.detail, 300);
  if (error.status === 400) return usage(detail, FORM_NEXT);
  if (isSignedOut(error))
    return refused(detail, "ask your person to sign in to Peer, then repeat the command.");
  if (!write || error.refused === true) return refused(detail, about.next);
  return new CliError(
    "uncertain",
    `the Hub did not answer, so ${about.command} may or may not have taken effect`,
    `${about.check} shows whether it did; repeating ${about.command} is safe`,
  );
}
