import type { PeerPlanRelation } from "@t3tools/contracts";
import { cutText, fenced, plain } from "../../../peerText.ts";
import { HINTS, what, whoOf, workOf, type Voice } from "../text.ts";
import { orient } from "./relations.ts";

/** What a session hears at its steps, worded: relations and challenges, each once, three at a step. */

export const NOTICE_MAX = 400;
const STEP_MAX = 1_150;
const STEP_RELATIONS = 3;

/** One relation as the other side's agent hears it at its next step: at most 400 characters, its contract line fenced as teammate text. */
export function noticeText(relation: PeerPlanRelation, voice: Voice): string | null {
  const oriented = orient(relation, voice.reader);
  if (oriented === null) return null;
  const { kind, other } = oriented;
  const thing = what(relation.item);
  const who = whoOf(other, voice);
  const ask = other.task === undefined ? null : plain(voice.task(other.task) ?? other.task, 60);
  const lead =
    kind === "changes-their-use"
      ? `${who} plans to use ${thing}, which your ${relation.observed ? "session already changed" : "plan changes"}.`
      : relation.observed
        ? `${workOf(other, voice)}’s session already changed ${thing}, which your plan ${kind === "same-change" ? "also changes" : "uses"}.`
        : kind === "uses-their-change"
          ? `${who} plans to change ${thing}, which your plan uses.`
          : `${who} also plans to change ${thing}${relation.certain ? "" : " (uncertain)"}.`;
  const tail =
    kind === "changes-their-use"
      ? ` If its contract changes, update your contract line: peer plan --amend --provides "${plain(relation.item.name ?? "<symbol>", 60)} (${plain(relation.item.path, 80)}): <contract>".`
      : ask === null
        ? ""
        : ` ${HINTS[kind]} ${ask}.`;
  const contract = kind === "uses-their-change" ? relation.contract : undefined;
  // The contract line gives way before the rest does, until the notice fits.
  for (let room = 200; ; room -= 40) {
    const said =
      contract === undefined || room <= 0
        ? ""
        : ` Their contract (teammate text):\n${fenced([`${thing}: ${plain(contract, room)}`])}`;
    const text = `[Peer] ${lead}${said}${tail}`;
    if (text.length <= NOTICE_MAX || room <= 0) return cutText(text, NOTICE_MAX);
  }
}

/**
 * What a session hears at one step of the relations it was not told of, then of `news` (challenges,
 * already worded): three at most within the step's room, and how many are left for later.
 */
export function stepText(
  fresh: ReadonlyArray<PeerPlanRelation>,
  voice: Voice,
  news: ReadonlyArray<string> = [],
) {
  const heard: PeerPlanRelation[] = [];
  const texts: string[] = [];
  let size = 0;
  const fits = (text: string | null): text is string =>
    text !== null && texts.length < STEP_RELATIONS && size + text.length + 2 <= STEP_MAX;
  const take = (text: string) => {
    texts.push(text);
    size += text.length + 2;
  };
  for (const relation of fresh) {
    const text = noticeText(relation, voice);
    if (!fits(text)) break;
    take(text);
    heard.push(relation);
  }
  let said = 0;
  for (const text of heard.length === fresh.length ? news : []) {
    if (!fits(text)) break;
    take(text);
    said += 1;
  }
  const left = fresh.length - heard.length;
  const later = news.length - said;
  const more = [
    ...(left > 0 ? [`Further plan relations: peer plan (${left} more)`] : []),
    ...(later > 0 ? [`Further challenges: peer plan challenge (${later} more)`] : []),
  ];
  return { heard, said, text: texts.length === 0 ? null : [...texts, ...more].join("\n\n") };
}
