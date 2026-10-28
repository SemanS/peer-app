import type {
  PeerPlanChallenge,
  PeerPlanChallenged,
  PeerPlanChallengeMet,
  PeerPlanChallengeRole,
  PeerPlanItem,
  PeerPlanSide,
  PeerPlansView,
} from "@t3tools/contracts";
import type { PeerHubError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { refused, type CliError, type PeerSessionView } from "../../../core/plugin.ts";
import { cutText, fenced, plain, plural, sinceText } from "../../../peerText.ts";
import { parseItem, type Bad } from "../items.ts";
import { ANSWER_MAX, compose, fence, itemText, what, whoOf, type Voice } from "../text.ts";
import { LACKS_CHALLENGES, type plansHub } from "./hub.ts";
import { NOTICE_MAX } from "./notices.ts";
import { ours, type Reader } from "./relations.ts";
import { CONTROL } from "./rules.ts";

/**
 * Challenges of plan items (plans revision 2): an agent says a fact other works build on does not
 * hold, and the agents of those works hear it once and decide for themselves. Advice only.
 */

/** A reason and a note hold at most this many characters, as the Hub's `text::line` keeps them. */
export const REASON_CHARS = 400;
const ID_CHARS = 100;

export type ChallengeRequest =
  | {
      readonly _tag: "challenge";
      readonly form: "record";
      readonly item: PeerPlanItem;
      readonly reason: string;
    }
  | {
      readonly _tag: "challenge";
      readonly form: "close";
      readonly id: string;
      readonly note?: string;
    }
  | { readonly _tag: "challenge"; readonly form: "show"; readonly id: string }
  | { readonly _tag: "challenge"; readonly form: "list" };

/** What a usage error of `peer plan challenge` ends with, written after its `Next: `. */
export const CHALLENGE_FORM =
  'peer plan challenge <item> --reason "<why>" | --close <id> [--note "<text>"] | --show <id>';

const FLAGS = ["--reason", "--note", "--close", "--show"] as const;
type Flag = (typeof FLAGS)[number];
const NEEDS: Readonly<Record<Flag, string>> = {
  "--reason": "a reason",
  "--note": "a note",
  "--close": "a challenge id",
  "--show": "a challenge id",
};

const bad = (reason: string): Bad => ({ reason, next: CHALLENGE_FORM });

/** A reason or note as the Hub keeps it: what a reader cannot see removed, 400 characters at most. */
function teammateText(raw: string, what: "reason" | "note"): string | Bad {
  const text = plain(raw, 10_000);
  if (what === "reason" && text === "")
    return bad(`a challenge needs a reason of 1 to ${REASON_CHARS} characters`);
  const length = [...text].length;
  return length > REASON_CHARS
    ? bad(`the ${what} has ${length} characters; a challenge takes at most ${REASON_CHARS}`)
    : text;
}

const validId = (id: string) => id.trim() !== "" && id.length <= ID_CHARS && !CONTROL.test(id);

/** What `peer plan challenge <args>` asks, or why it is no challenge; parsing never touches the Hub. */
export function parseChallenge(args: ReadonlyArray<string>, root: string): ChallengeRequest | Bad {
  const flags = new Map<Flag, string>();
  const items: string[] = [];
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at] ?? "";
    const flag = FLAGS.find((one) => one === arg);
    if (flag !== undefined) {
      const value = args[at + 1];
      if (value === undefined || value.startsWith("--")) return bad(`${flag} needs ${NEEDS[flag]}`);
      if (flags.has(flag)) return bad(`${flag} is given twice`);
      flags.set(flag, value);
      at += 1;
    } else if (arg.startsWith("--"))
      return bad(`${plain(arg, 40)} is not a flag of peer plan challenge`);
    else items.push(arg);
  }
  const [reason, note, close, show] = FLAGS.map((flag) => flags.get(flag));
  for (const id of [close, show])
    if (id !== undefined && !validId(id))
      return bad(`a challenge id has 1 to ${ID_CHARS} visible characters`);
  if (show !== undefined)
    return flags.size === 1 && items.length === 0
      ? { _tag: "challenge", form: "show", id: show.trim() }
      : bad("--show <id> stands alone");
  if (close !== undefined) {
    if (items.length > 0 || reason !== undefined)
      return bad("--close <id> takes only a --note: the challenge already names its item");
    if (note === undefined) return { _tag: "challenge", form: "close", id: close.trim() };
    const text = teammateText(note, "note");
    if (typeof text !== "string") return text;
    return {
      _tag: "challenge",
      form: "close",
      id: close.trim(),
      ...(text === "" ? {} : { note: text }),
    };
  }
  if (note !== undefined) return bad("--note goes with --close <id>");
  if (items.length > 1) return bad("a challenge names one item; challenge each on its own");
  const [raw] = items;
  if (raw === undefined)
    return reason === undefined
      ? { _tag: "challenge", form: "list" }
      : bad("--reason needs the item it is about before it");
  if (reason === undefined) return bad(`a challenge of ${plain(raw, 100)} needs --reason "<why>"`);
  const item = parseItem(root, raw);
  if ("reason" in item) return bad(item.reason);
  const text = teammateText(reason, "reason");
  if (typeof text !== "string") return text;
  return { _tag: "challenge", form: "record", item: item.item, reason: text };
}

const DOES: Readonly<Record<PeerPlanChallengeRole, string>> = {
  uses: "uses",
  changes: "changes",
  maybe: "may change",
  provides: "provides",
};
const id = (challenge: PeerPlanChallenge) => plain(challenge.id, ID_CHARS);
const ago = (iso: string, voice: Voice) => sinceText(Math.max(0, voice.now - Date.parse(iso)));
/** Who a side is, where the reader may be on it. */
const who = (side: PeerPlanSide, voice: Voice) =>
  ours(side, voice.reader) ? "your session" : whoOf(side, voice);
const mineOf = (challenge: PeerPlanChallenge, reader: Reader) =>
  challenge.meets.find((met) => ours(met.side, reader));

/** One work an item meets: who, what its plan does with it, and its contract line as teammate text. */
function metLines(met: PeerPlanChallengeMet, voice: Voice) {
  const contract = met.role === "provides" ? met.contract : undefined;
  return [
    `${who(met.side, voice)} ${DOES[met.role]} it.${contract === undefined ? "" : " Its contract (teammate text):"}`,
    ...(contract === undefined ? [] : fence(plain(contract, 200))),
  ].join("\n");
}

/** What `peer plan challenge <item> --reason` answers. */
export function recordedText({ challenge, changed, hearing }: PeerPlanChallenged, voice: Voice) {
  const others = challenge.meets.filter((met) => !ours(met.side, voice.reader));
  const verb = !changed
    ? "unchanged"
    : challenge.createdAt === challenge.updatedAt
      ? "recorded"
      : "re-stated with the new reason";
  const head = [
    `Challenge ${id(challenge)} ${verb}: ${itemText(challenge.item)}.`,
    others.length === 0
      ? "Nobody works on the item now. A plan declared later that meets it reads it in its answer."
      : `It meets ${plural(others.length, "work")}; ${plural(hearing, "live session")} will hear it at the next step:`,
  ];
  return compose(
    head,
    others.map((met) => metLines(met, voice)),
    [
      "Each decides whether its plan changes.",
      `Close it when it is settled: peer plan challenge --close ${id(challenge)} --note "<why>"`,
    ],
    ANSWER_MAX,
    `peer plan challenge --show ${id(challenge)}`,
  );
}

/** What `peer plan challenge --close` answers: closed now, or already. */
export function closedText({ challenge, changed }: PeerPlanChallenged, voice: Voice) {
  const named = `Challenge ${id(challenge)} of ${itemText(challenge.item)}`;
  if (changed || challenge.closed === undefined)
    return `${named} closed. The sessions that heard it hear the close at their next step.`;
  return `${named} was already closed by ${who(challenge.closed.by, voice)} ${ago(challenge.closed.at, voice)}. Nothing changed.`;
}

function oneText(challenge: PeerPlanChallenge, voice: Voice) {
  const { closed } = challenge;
  const noted =
    closed === undefined
      ? []
      : closed.note === undefined
        ? [`Closed by ${who(closed.by, voice)} ${ago(closed.at, voice)}, with no note.`]
        : [
            `Closed by ${who(closed.by, voice)} ${ago(closed.at, voice)}. Note (teammate text):`,
            ...fence(plain(closed.note, REASON_CHARS)),
          ];
  return compose(
    [
      `Challenge ${id(challenge)} · ${challenge.state} · ${itemText(challenge.item)}`,
      `By ${who(challenge.by, voice)} ${ago(challenge.createdAt, voice)}. Reason (teammate text):`,
      ...fence(plain(challenge.reason, REASON_CHARS)),
      ...noted,
      challenge.meets.length === 0 ? "Nobody works on the item now." : "It meets:",
    ],
    challenge.meets.map((met) => metLines(met, voice)),
    challenge.state === "open"
      ? [
          `Close: peer plan challenge --close ${id(challenge)} [--note "<text>"] (its challenger, or a work that changes or provides the item)`,
        ]
      : [],
    ANSWER_MAX,
  );
}

function listText(challenges: ReadonlyArray<PeerPlanChallenge>, voice: Voice, project: string) {
  if (challenges.length === 0) return "Nothing in the project is challenged.";
  const mine = (challenge: PeerPlanChallenge) => mineOf(challenge, voice.reader) !== undefined;
  const sorted = [...challenges.filter(mine), ...challenges.filter((one) => !mine(one))];
  const open = challenges.filter((one) => one.state === "open").length;
  return compose(
    [
      `Challenges in ${plain(project, 80)}: ${open} open, ${challenges.length - open} closed. * meets your plan.`,
    ],
    sorted.map(
      (one) =>
        `${mine(one) ? "*" : " "} ${id(one)} · ${one.state} · ${itemText(one.item)} · ${who(one.by, voice)} · ${ago(one.createdAt, voice)}`,
    ),
    ["Read one: peer plan challenge --show <id>"],
    ANSWER_MAX,
    "",
  );
}

/** What `peer plan challenge` and `--show <id>` answer from a project's challenges, or the refusal of an unknown id. */
export function readText(
  request: ChallengeRequest,
  challenges: ReadonlyArray<PeerPlanChallenge>,
  voice: Voice,
  project: string,
): string | CliError {
  if (request.form !== "show") return listText(challenges, voice, project);
  const found = challenges.find((one) => one.id === request.id);
  return found === undefined
    ? refused(
        `no challenge ${plain(request.id, ID_CHARS)} in this project; a closed one goes away a day after it closed`,
        "peer plan challenge lists the project's challenges.",
      )
    : oneText(found, voice);
}

/**
 * What a session is told of a challenge once: its id and when it last moved, so a re-stated reason
 * or a close is told once more and nothing else is. Ids and times only, no words.
 */
export const challengeKey = (challenge: PeerPlanChallenge) =>
  `challenge:${challenge.id}:${challenge.updatedAt}`;
const heardOf = (told: ReadonlySet<string>, challenge: PeerPlanChallenge) => {
  const prefix = `challenge:${challenge.id}:`;
  for (const key of told) if (key.startsWith(prefix)) return true;
  return false;
};

/** The open challenges of a declare answer that a session hears of: not its own. */
export const othersOpen = (challenges: ReadonlyArray<PeerPlanChallenge>, reader: Reader) =>
  challenges.filter((one) => one.state === "open" && !ours(one.by, reader));

export interface News {
  readonly challenge: PeerPlanChallenge;
  readonly kind: "open" | "close";
}

/**
 * What a session has to hear of a project's challenges: open ones its plan meets, not its own, and
 * the closes of those it heard (its own included), each once. `quiet` are keys to mark told without
 * saying anything: the session closed the challenge itself.
 */
export function challengeNews(
  view: PeerPlansView | undefined,
  reader: Reader,
  project: string,
  told: ReadonlySet<string>,
) {
  const news: News[] = [];
  const quiet: string[] = [];
  for (const challenge of view?.challenges ?? []) {
    if (challenge.project !== project || told.has(challengeKey(challenge))) continue;
    if (challenge.state === "open") {
      if (!ours(challenge.by, reader) && mineOf(challenge, reader) !== undefined)
        news.push({ challenge, kind: "open" });
    } else if (heardOf(told, challenge) || ours(challenge.by, reader)) {
      if (challenge.closed !== undefined && ours(challenge.closed.by, reader))
        quiet.push(challengeKey(challenge));
      else news.push({ challenge, kind: "close" });
    }
  }
  return { news, quiet };
}

/** Teammate text that gives way, 40 characters at a time, until the notice fits 400 characters. */
function fitted(make: (room: number) => string) {
  for (let room = REASON_CHARS; ; room -= 40) {
    const text = make(room);
    if (text.length <= NOTICE_MAX || room <= 40) return cutText(text, NOTICE_MAX);
  }
}

/** One challenge or close as a session hears it at its next step: at most 400 characters, the reason or note fenced. */
export function newsText({ challenge, kind }: News, voice: Voice): string {
  const thing = what(challenge.item);
  const named = id(challenge);
  if (kind === "close") {
    const by = challenge.closed?.by ?? challenge.by;
    const note = challenge.closed?.note;
    const lead = `[Peer] ${who(by, voice)} closed the challenge of ${thing} (${named}).`;
    return fitted((room) =>
      note === undefined
        ? `${lead} No note.`
        : `${lead} Note (teammate text):\n${fenced([plain(note, room)])}`,
    );
  }
  const met = mineOf(challenge, voice.reader);
  const role = met?.role ?? "uses";
  const owns = role === "changes" || role === "provides";
  const contract =
    role === "provides" && met?.contract !== undefined
      ? ` Your contract line: ${plain(met.contract, 100)}.`
      : "";
  const tail = `${contract} You decide whether your plan changes. Read it: peer plan challenge --show ${named}${owns ? `; settled: --close ${named}` : ""}${role === "provides" ? "; or declare a new contract line with peer plan --amend --provides" : ""}.`;
  return fitted(
    (room) =>
      `[Peer] ${whoOf(challenge.by, voice)} challenges ${thing}, which your plan ${DOES[role]}. Reason (teammate text):\n${fenced([plain(challenge.reason, room)])}\n${tail.trim()}`,
  );
}

/**
 * What the metrics need of challenges: which of this computer's sessions each was told to, and
 * which were open at a workspace's last read, so one that vanished without a close counts as lapsed.
 */
export function createLedger() {
  const told = new Map<string, Set<string>>();
  const open = new Map<string, ReadonlySet<string>>();
  return {
    told(challenge: string, session: string) {
      const sessions = told.get(challenge) ?? new Set();
      sessions.add(session);
      told.set(challenge, sessions);
    },
    /** A workspace's view was read: how many sessions each challenge that lapsed since was told to. */
    lapsed(workspace: string, view: PeerPlansView) {
      const now = new Map((view.challenges ?? []).map((one) => [one.id, one.state]));
      const lapsed: number[] = [];
      for (const challenge of open.get(workspace) ?? [])
        if (!now.has(challenge)) {
          lapsed.push(told.get(challenge)?.size ?? 0);
          told.delete(challenge);
        }
      open.set(
        workspace,
        new Set([...now].filter(([, state]) => state === "open").map(([one]) => one)),
      );
      return lapsed;
    },
    forget(workspace?: string) {
      if (workspace === undefined) told.clear();
      for (const slug of open.keys())
        if (workspace === undefined || slug === workspace) open.delete(slug);
    },
  };
}

/** What `peer plan challenge` needs of the plugin's service. */
export interface ChallengeDeps {
  readonly hub: ReturnType<typeof plansHub>;
  readonly environment: string;
  /** The Hub's view of a workspace now. */
  readonly read: (workspace: string) => Effect.Effect<PeerPlansView, PeerHubError>;
  readonly voice: (session: PeerSessionView) => Effect.Effect<Voice>;
  /** A challenge moved in a workspace: its view is read again soon. */
  readonly changed: (workspace: string) => void;
  readonly log: (event: string, fields: Readonly<Record<string, unknown>>) => Effect.Effect<void>;
}

/**
 * Records, closes, lists or shows challenges, and says what it did. A record or close logs its
 * size and how many sessions hear it, never its words.
 */
export const challengeCommand =
  ({ hub, environment, read, voice, changed, log }: ChallengeDeps) =>
  (session: PeerSessionView, request: ChallengeRequest) =>
    Effect.gen(function* () {
      if (request.form === "list" || request.form === "show") {
        if (!(yield* hub.challengesServed)) return yield* Effect.fail(LACKS_CHALLENGES);
        const view = yield* read(session.workspace);
        const mine = (view.challenges ?? []).filter((one) => one.project === session.project);
        const text = readText(request, mine, yield* voice(session), session.project);
        return typeof text === "string" ? text : yield* Effect.fail(text);
      }
      const { workspace, project } = session;
      const ids = { environment, session: session.id };
      const answer =
        request.form === "record"
          ? yield* hub.challenge(workspace, project, {
              ...ids,
              item: request.item,
              reason: request.reason,
            })
          : yield* hub.closeChallenge(workspace, project, {
              ...ids,
              close: request.id,
              ...(request.note === undefined ? {} : { note: request.note }),
            });
      changed(workspace);
      const recorded = request.form === "record";
      const text = (recorded ? recordedText : closedText)(answer, yield* voice(session));
      yield* log(recorded ? "plans.challenge.recorded" : "plans.challenge.closed", {
        session: session.id,
        changed: answer.changed,
        hearing: answer.hearing,
        chars: text.length,
      });
      return text;
    });
