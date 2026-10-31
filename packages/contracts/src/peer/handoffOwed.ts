/**
 * What an agent hears of a handoff: pure words over its facts, for `peer review` and `peer handoff`.
 * `HANDOFF_RULES` of the client runtime classifies the same facts for people; the server does not
 * depend on that package, so what is of class `agent_action` is spelled here too.
 */
import type {
  PeerHandoffDelivery,
  PeerHandoffPackage,
  PeerHandoffPolicy,
  PeerHandoffSignals,
} from "./handoff.ts";

/** The most owed items a reply names; `peer tests show` has the rest. */
const OWED_SHOWN = 5;

/** The facts of a handoff the agent can answer for, as it is told them. */
export interface HandoffFacts {
  readonly delivery?: PeerHandoffDelivery | undefined;
  readonly policy?: PeerHandoffPolicy | undefined;
  readonly report?: PeerHandoffPackage["report"];
  /** The Hub's current facts, with each item's text; the package's stand in without them. */
  readonly live?: PeerHandoffSignals | undefined;
}

const NO_REPORT = "no test report: file one with peer tests";
const nobody = (text: string) => `unverified, nobody answers for it: ${text}`;

/**
 * The task's newest test report in one line, apart from the author's own checks: its result, the
 * counts, and the unverified items nobody answers for (`escape` makes their text safe where it goes;
 * without it, as in a pointer-only block, only how many).
 */
export function handoffReportLine(
  report: PeerHandoffPackage["report"],
  escape?: (text: string) => string,
): string {
  if (report === undefined) return "No test report was filed.";
  const counts = `${report.passed} passed, ${report.failed} failed, ${report.unverified} unverified`;
  const unowned =
    report.unowned.length === 0
      ? ""
      : escape === undefined
        ? ` · ${report.unowned.length} ${report.unowned.length === 1 ? "needs" : "need"} an owner`
        : ` · needs an owner: ${report.unowned.map(escape).join(", ")}`;
  return `Tests: ${report.result} · ${counts}${unowned}.`;
}

/**
 * What the agent owes after a handoff, each with its text in `quote`'s words. Nothing when the
 * policy accepted it or an older Hub did not evaluate it.
 */
export function handoffOwed(
  { delivery, policy, report, live }: HandoffFacts,
  quote: (text: string) => string,
): ReadonlyArray<string> {
  if (policy === undefined || policy.accepted) return [];
  const notDelivered =
    delivery === undefined
      ? ["delivery: not observed"]
      : delivery.state === "none" || delivery.state === "local"
        ? [`delivery: ${delivery.state}, commit and push the work`]
        : [];
  if (live?.evaluated === true)
    return [
      ...((live.reports ?? []).length === 0 ? [NO_REPORT] : []),
      ...notDelivered,
      ...(live.items ?? []).flatMap((item) => {
        if (item.failed) return item.task === undefined ? [`failed: ${quote(item.text)}`] : [];
        return item.owner === undefined && item.task === undefined
          ? [nobody(quote(item.text))]
          : [];
      }),
      ...(live.ownerCalls ?? []).flatMap((call) =>
        call.state === "declined"
          ? [`an owner declined your call on ${call.paths.join(", ")}`]
          : [],
      ),
    ];
  const failed = report?.failed ?? 0;
  return [
    ...(report === undefined ? [NO_REPORT] : []),
    ...notDelivered,
    ...(failed > 0
      ? [`${failed} failed ${failed === 1 ? "item" : "items"}: see peer tests show`]
      : []),
    ...(report?.unowned ?? []).map((text) => nobody(quote(text))),
  ];
}

/**
 * What the project's review policy made of the handoff; nothing from an older Hub. While the agent
 * owes something it hears that and nothing about a person: this reply is the turn it can act in.
 */
export function handoffPolicyLines(
  policy: PeerHandoffPolicy | undefined,
  owed: ReadonlyArray<string> = [],
): ReadonlyArray<string> {
  if (policy === undefined) return [];
  if (policy.accepted) return [`Accepted by policy v${policy.version}.`];
  if (owed.length > 0) {
    const rest = owed.length - OWED_SHOWN;
    return [
      "Yours before a person reads this handoff:",
      ...owed.slice(0, OWED_SHOWN).map((item) => `- ${item}`),
      ...(rest > 0 ? [`- and ${rest} more: peer tests show`] : []),
      'Run or fix each, or leave it with peer tests (--fail "<text> @task:<key>", --unverified "<text> @<person>"), then run peer review again.',
    ];
  }
  if (policy.signals.length > 0)
    return [`Waits for a person's review: ${policy.signals.join(", ")}.`];
  return ["Waits for a person's review: the project asks one for every handoff."];
}
