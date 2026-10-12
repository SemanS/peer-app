import type {
  PeerHubError,
  PeerPlanItem,
  PeerPlanMode,
  PeerPlanProvides,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import {
  CliError,
  isSignedOut,
  refused,
  usage,
  type PeerCommand,
  type PeerSessionView,
} from "../../core/plugin.ts";
import { plain } from "../../peerText.ts";
import type { Items } from "./client/hub.ts";
import {
  MAX_CHANGES,
  MAX_PROVIDES,
  MAX_USES,
  isEmpty,
  itemKey,
  once,
  overLimits,
  parseItem,
  parseProvides,
  type Bad,
} from "./items.ts";
import {
  WITHDRAWN,
  answerText,
  form,
  publicText,
  showText,
  type DeclareAnswer,
  type PublicAnswer,
  type ShowAnswer,
} from "./text.ts";

/** The form a usage error ends with, written after its `Next: `. */
export const FORM_NEXT = form(6);

export type Request =
  | { readonly _tag: "show" }
  | { readonly _tag: "withdraw" }
  | { readonly _tag: "declare"; readonly mode: PeerPlanMode; readonly items: Items };

/** What `peer plan <args>` asks, or why it is no plan; parsing never touches the Hub. */
export function parsePlan(args: ReadonlyArray<string>, root: string): Request | Bad {
  const lists = {
    "--change": [] as PeerPlanItem[],
    "--maybe": [] as PeerPlanItem[],
    "--uses": [] as PeerPlanItem[],
  };
  const provides: PeerPlanProvides[] = [];
  let amend = false;
  let withdraw = false;
  for (let at = 0; at < args.length; at += 1) {
    const flag = args[at] ?? "";
    if (flag === "--amend" || flag === "--withdraw") {
      amend ||= flag === "--amend";
      withdraw ||= flag === "--withdraw";
    } else if (flag === "--provides" || Object.hasOwn(lists, flag)) {
      at += 1;
      const value = args[at];
      if (value === undefined || value.startsWith("--"))
        return { reason: `${flag} needs ${flag === "--provides" ? "a contract line" : "an item"}` };
      const got = flag === "--provides" ? parseProvides(root, value) : parseItem(root, value);
      if ("reason" in got) return got;
      if ("provides" in got) provides.push(got.provides);
      else lists[flag as keyof typeof lists].push(got.item);
    } else {
      return {
        reason: flag.startsWith("--")
          ? `${plain(flag, 40)} is not a flag of peer plan`
          : `"${plain(flag, 60)}" is not a flag or the value of one`,
      };
    }
  }
  const items: Items = {
    changes: once(lists["--change"], itemKey),
    maybes: once(lists["--maybe"], itemKey),
    uses: once(lists["--uses"], itemKey),
    provides: once(provides, itemKey),
  };
  if (withdraw)
    return isEmpty(items) && !amend
      ? { _tag: "withdraw" }
      : { reason: "--withdraw stands alone: it takes no items and no --amend" };
  if (isEmpty(items))
    return amend ? { reason: "--amend needs at least one item to add" } : { _tag: "show" };
  if (overLimits(items))
    return {
      reason: `a plan holds at most ${MAX_CHANGES} changes and maybes together, ${MAX_USES} uses and ${MAX_PROVIDES} contract lines; this one names ${items.changes.length + items.maybes.length}, ${items.uses.length} and ${items.provides.length}`,
    };
  return { _tag: "declare", mode: amend ? "amend" : "replace", items };
}

type Failed = PeerHubError | CliError;

/** What the command asks of the plugin's service. */
export interface PlansCommands {
  readonly declare: (
    session: PeerSessionView,
    input: { readonly mode: PeerPlanMode; readonly items: Items },
  ) => Effect.Effect<DeclareAnswer, Failed>;
  readonly show: (session: PeerSessionView) => Effect.Effect<ShowAnswer, Failed>;
  /** How many plans ended: the Hub's, and the declaration still waiting to be sent. */
  readonly withdraw: (
    session: PeerSessionView,
  ) => Effect.Effect<{ readonly ended: number }, Failed>;
  readonly publicView: (session: PeerSessionView) => Effect.Effect<PublicAnswer, Failed>;
}

/**
 * A failed call to the Hub as `peer-cli-contract` has it: a 400 is usage, another 4xx refused, no
 * answer to a write uncertain; a read is only ever refused.
 */
export function hubOutcome(error: Failed, write: boolean) {
  if (error instanceof CliError) return error;
  const detail = plain(error.detail, 300);
  if (error.status === 400) return usage(detail, FORM_NEXT);
  if (isSignedOut(error))
    return refused(detail, "ask your person to sign in to Peer, then repeat the command.");
  if (!write || error.refused === true)
    return refused(detail, "run peer plan to see the plan as it is.");
  return new CliError(
    "uncertain",
    "the Hub did not answer, so peer plan --withdraw may or may not have taken effect",
    "peer plan shows whether it did; repeating peer plan --withdraw is safe",
  );
}

export const planCommand = (plans: PlansCommands): PeerCommand => ({
  name: "plan",
  usage:
    'plan [--amend] [--change <item>]... [--maybe <item>]... [--uses <item>]... [--provides "<symbol> (<path>): <contract>"]... | --withdraw',
  summary:
    "say what you will change, use and provide before you edit; it shows whose work meets yours",
  public: true,
  run: ({ session, args }) =>
    Effect.gen(function* () {
      const request = parsePlan(args, session.root);
      if ("reason" in request)
        return yield* Effect.fail(usage(plain(request.reason, 300), request.next ?? FORM_NEXT));
      const as = <A>(effect: Effect.Effect<A, Failed>, write = false) =>
        effect.pipe(Effect.mapError((error) => hubOutcome(error, write)));
      if (session.public === true) {
        if (request._tag === "show") return publicText(yield* as(plans.publicView(session)));
        return yield* Effect.fail(
          refused(
            "this call does not come from an agent session, so Peer cannot tell whose plan to change",
            "run peer plan with items from the shell of an agent session; a person uses the Peer app: Work, then the task.",
          ),
        );
      }
      if (request._tag === "show") return showText(yield* as(plans.show(session)));
      if (request._tag === "declare")
        return answerText(
          yield* as(plans.declare(session, { mode: request.mode, items: request.items }), true),
        );
      if ((yield* as(plans.withdraw(session), true)).ended > 0) return WITHDRAWN;
      return yield* Effect.fail(
        refused(
          "this session has no plan to withdraw",
          "declare one with peer plan --change <path[#symbol]>.",
        ),
      );
    }),
});
