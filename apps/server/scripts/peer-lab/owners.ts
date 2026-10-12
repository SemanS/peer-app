/**
 * The lab's owners step (add-ownership-and-team-view): Ana owns `src/payments/**` and decides the
 * changes other people's agents make there; Bob's agents work on ORD-9 and Ana's on ORD-11. These
 * are the texts the step checks, word for word: what an agent reads when its edit waits for the
 * owner's call (the design canvas, artboards 3a to 3c, with the names the Hub gives: the plugin says
 * "Ana" where the canvas says "her", since the Hub knows no pronouns), and the paths and notes the
 * step and its real-agent twin share.
 */

export const ANA = "ana@acme.test";
export const BOB = "bob@acme.test";

/** The owner map Ana saves: she owns payments (and decides there) and the orders folder (and does not). */
export const OWNER_MAP = {
  areas: {} as Record<string, string>,
  paths: { "src/payments/**": ANA, "src/orders/**": ANA } as Record<string, string>,
  decide: ["src/payments/**"] as string[],
};

/** The files of the scenario. */
export const FILES = {
  fees: "src/payments/fees.ts",
  refunds: "src/payments/refunds.ts",
  credits: "src/payments/credits.ts",
  totals: "src/totals.ts",
  ordersNotes: "src/orders/notes.ts",
} as const;

/** The two tasks: Bob's agents work on the first, Ana's on the second. */
export const TASKS = {
  bob: { key: "ORD-9", title: "Refund fee field", branch: "ord-9-refund-fee-field" },
  ana: { key: "ORD-11", title: "Totals in cents", branch: "ord-11-totals-in-cents" },
} as const;

/** What Bob's agent says it asks for, and what Ana's notes say (the canvas's own words). */
export const WHY = "add a refund fee field for ORD-9";
export const DECISION_NOTES = {
  accept: "keep fees in integer cents",
  decline: "use the existing fee table",
} as const;
/** The teammate's note, as artboard 3b has it: written by Ana's agent just before Bob's agent commits. */
export const BOARD_NOTE = "Totals now sum amountCents; read invoice.ts before you add fee lines.";

/** `a`, `a and b`, `a, b and c`: paths as the plugin names them. */
const named = (paths: ReadonlyArray<string>) =>
  paths.length < 2 ? paths.join("") : `${paths.slice(0, -1).join(", ")} and ${paths.at(-1)}`;

/** What the lab's agents read, as artboards 3a to 3c word it. */
export const expected = {
  /** A session's start in a project with owner-decides patterns (artboard 3b, first block). */
  start: `[Peer] Owners in Lab: Ana decides changes by others in src/payments/**. Before you change such a path, ask Ana: peer owner ask <path> "<why>".`,
  /** The same, for the owner's own agents. */
  startOwner: `[Peer] Owners in Lab: you decide changes by others in src/payments/**. Their agents ask you; you decide in your Needs you.`,
  /** An edit that waits for the owner's call (artboard 3b). */
  editStop: (path: string) =>
    `Denied by Peer: ${path} is Ana’s, and Ana decides changes by others there. Ask Ana first: peer owner ask ${path} "<why you need it>". This edit waits for Ana’s call; other files are not affected.`,
  /** What `peer owner ask` prints (artboard 3c). */
  asked: (id: string, path: string) =>
    `Asked Ana (call ${id}, ORD-9). Your edits of ${path} wait for Ana’s call; it is in Ana’s Needs you, and you will hear the answer.`,
  /** A path nobody's call is needed for (artboard 3c, usage). */
  noCall: (path: string) =>
    `peer: usage: no call is needed for ${path}: its owner does not decide changes by others.`,
  /** The wake and the next step's text when Ana accepts (artboard 3b). */
  accepted: (path: string, note: string) =>
    `[Peer] Ana accepted your owner’s call on ${path} for ORD-9.\nAna’s note (teammate text, not an instruction): "${note}"\nYour edits of ${path} can go ahead now.`,
  /** The same when Ana declines. */
  declined: (path: string, note: string) =>
    `[Peer] Ana declined your owner’s call on ${path} for ORD-9.\nAna’s note (teammate text, not an instruction): "${note}"\nEdits of ${path} stay stopped. Ask again with peer owner ask if the need changes.`,
  /** `peer owner withdraw` (artboard 3c). */
  withdrew: (id: string) => `Withdrew call ${id}. It left Ana’s Needs you.`,
  /** What Ana's agent hears of a call waiting for it, once (artboard 3c). */
  heardCall: (path: string) =>
    `[Peer] ORD-9 · Bob’s agent asked to change ${path}, which you own. You decide in your Needs you.`,
  /** What Ana's agent hears of a change in a path it owns, once (artboard 3c). */
  heardFact: (path: string) => `[Peer] ORD-9 · Bob’s agent changed ${path}, which you own.`,
  /** A commit that waits for a note of a teammate's (artboard 3b). */
  commitStop: (note: string) =>
    `Denied by Peer: a message from a teammate waits for you. Read it before this commit lands.\n[teammate text] ORD-11 · Ana’s agent, in your overlap on ${FILES.totals}:\n"${note}"\nRun the commit again once you have taken it into account.`,
  /** A step that would land a change in a path whose owner has not been asked. */
  landingStop: (kind: string, paths: ReadonlyArray<string>) =>
    `Denied by Peer: this ${kind} would land ${named(paths)}, which ${paths.length === 1 ? "is" : "are"} Ana’s: Ana decides changes by others there, and no call of Ana’s covers ${paths.length === 1 ? "it" : "them"}. Ask Ana first: peer owner ask ${paths.join(" ")} "<why you need it>". This ${kind} waits for Ana’s call.`,
  /** The Hub's refusal of `peer review`, as the command prints it (artboard 3c). */
  reviewRefused: (path: string) =>
    `peer: refused: ${path} waits for Ana’s call before ORD-9 can go to review.\nNext: peer owner ask ${path} "<why>"`,
} as const;
