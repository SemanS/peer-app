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
import {
  MAX_CHANGES,
  MAX_PROVIDES,
  MAX_USES,
  isEmpty,
  once,
  overLimits,
  parseItem,
  parseProvides,
  type Bad,
  type Items,
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

const itemKey = (item: { readonly path: string; readonly name?: string | undefined }) =>
  `${item.path}\u0000${item.name ?? ""}`;

/**
 * What `peer plan <args>` asks, or why it is no plan. Parsing never touches the network or the
 * Hub: a bad item makes the whole command a usage error, and nothing is recorded.
 */
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

/** What a declaration came to when the Hub did not simply record it. */
export type Declared =
  | ({ readonly _tag: "recorded" } & DeclareAnswer)
  /** The Hub did not answer: the declaration waits, and Peer sends it again. */
  | { readonly _tag: "pending" }
  /** The Hub has no route for plans. */
  | { readonly _tag: "unsupported" }
  /** The Hub holds a newer declaration of the session. */
  | { readonly _tag: "stale" };

type Failed = PeerHubError | CliError;

/** What the command asks of the plugin's service. */
export interface PlansCommands {
  readonly declare: (
    session: PeerSessionView,
    input: { readonly mode: PeerPlanMode; readonly items: Items },
  ) => Effect.Effect<Declared, Failed>;
  readonly show: (session: PeerSessionView) => Effect.Effect<ShowAnswer, Failed>;
  /** How many plans ended: the Hub's, and the declaration still waiting to be sent. */
  readonly withdraw: (
    session: PeerSessionView,
  ) => Effect.Effect<{ readonly ended: number }, Failed>;
  readonly publicView: (session: PeerSessionView) => Effect.Effect<PublicAnswer, Failed>;
}

/** The Hub gave no answer to a declaration: it waits, and Peer sends it again. */
const declarationUncertain = () =>
  new CliError(
    "uncertain",
    "the Hub did not answer; Peer sends this plan again when it answers and records it once",
    "peer plan",
  );

/**
 * What a failed call to the Hub is for the command, as `peer-cli-contract` says: a 400 is usage,
 * another 4xx refused, and no answer or a 5xx uncertain, but a read is only ever refused.
 */
export function hubOutcome(error: Failed, doing: "read" | "declare" | "withdraw") {
  if (error instanceof CliError) return error;
  const detail = plain(error.detail, 300);
  if (error.status === 400) return usage(detail, FORM_NEXT);
  if (isSignedOut(error))
    return refused(detail, "ask your person to sign in to Peer, then repeat the command.");
  if (doing === "read") return refused(detail, "run peer plan again when the Hub can be reached.");
  if (error.refused === true) return refused(detail, "run peer plan to see the plan as it is.");
  return doing === "declare"
    ? declarationUncertain()
    : new CliError(
        "uncertain",
        "the Hub did not answer, so peer plan --withdraw may or may not have taken effect",
        "peer plan shows whether it did; repeating peer plan --withdraw is safe",
      );
}

const NOT_AN_AGENT = refused(
  "this call does not come from an agent session, so Peer cannot tell whose plan to change",
  "run peer plan with items from the shell of an agent session; a person uses the Peer app: Work, then the task.",
);

const declined = (declared: Exclude<Declared, { readonly _tag: "recorded" }>) =>
  declared._tag === "pending"
    ? declarationUncertain()
    : declared._tag === "unsupported"
      ? refused(
          "plans need a newer Peer Hub; nothing was recorded",
          "ask a workspace admin to update the Hub",
        )
      : refused(
          "a newer declaration of this plan is stored, so this one was not applied",
          "peer plan shows the plan as it is.",
        );

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
      const as = <A>(effect: Effect.Effect<A, Failed>, doing: "read" | "declare" | "withdraw") =>
        effect.pipe(Effect.mapError((error) => hubOutcome(error, doing)));
      if (session.public === true) {
        if (request._tag !== "show") return yield* Effect.fail(NOT_AN_AGENT);
        return publicText(yield* as(plans.publicView(session), "read"));
      }
      if (request._tag === "show") return showText(yield* as(plans.show(session), "read"));
      if (request._tag === "withdraw") {
        const { ended } = yield* as(plans.withdraw(session), "withdraw");
        if (ended > 0) return WITHDRAWN;
        return yield* Effect.fail(
          refused(
            "this session has no plan to withdraw",
            "declare one with peer plan --change <path[#symbol]>.",
          ),
        );
      }
      const declared = yield* as(
        plans.declare(session, { mode: request.mode, items: request.items }),
        "declare",
      );
      return declared._tag === "recorded"
        ? answerText(declared)
        : yield* Effect.fail(declined(declared));
    }),
});
