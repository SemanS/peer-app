/**
 * The question Claude Code and Codex put in a new folder, before their session starts and so before
 * any hook. It exists only on the terminal: Peer reads it there and answers with the keys a person
 * would press. Which answer is first and preselected differs by harness and version, so the moves
 * come from the screen.
 *
 * @module peerHub/plugins/herdr/client/trust
 */

const YES = /^(?:\d+\.\s*)?(?:Yes, I trust this folder|Yes, continue)\b/;
const NO = /^(?:\d+\.\s*)?(?:No, exit|No, quit)\b/;
const ASKED = /one you trust|trust this folder|trust the contents of this directory/i;
const CURSOR = /^[❯›>]\s*/;
/** A menu sits at the end of the screen: the same words higher up are only text. */
const MENU_LINES = 6;

export interface TrustQuestion {
  /** Lines from the top of the menu, of the selected answer and of each answer. */
  readonly cursor: number;
  readonly yes: number;
  readonly no: number;
}

/** The question as the screen shows it now; null unless it is the live menu. */
export function trustQuestionOf(screen: string): TrustQuestion | null {
  if (!ASKED.test(screen)) return null;
  const lines = screen
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(-MENU_LINES);
  const words = lines.map((line) => line.replace(CURSOR, ""));
  const cursor = lines.findIndex((line) => CURSOR.test(line));
  const yes = words.findIndex((line) => YES.test(line));
  const no = words.findIndex((line) => NO.test(line));
  return cursor < 0 || yes < 0 || no < 0 || (cursor !== yes && cursor !== no)
    ? null
    : { cursor, yes, no };
}

/** herdr's keys that give the answer. */
export function trustKeys(question: TrustQuestion, trust: boolean) {
  const moves = (trust ? question.yes : question.no) - question.cursor;
  return [...Array<string>(Math.abs(moves)).fill(moves > 0 ? "down" : "up"), "enter"];
}
