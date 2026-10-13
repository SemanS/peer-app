/**
 * The owner's call on the phone: what its card and its decide sheet say, what a decision sends and
 * when the buttons wait. The call arrives as a Needs you item (`deriveNeedsYou` makes it for its
 * owner, and for a lead when the owner left); everything else is read from the computers' statuses,
 * which carry the project's ownership view, its tasks and its names.
 *
 * Pure, so each state of the sheet (the owner, a lead deciding for them, a pairing without operate
 * access, a computer that is away) is tested without drawing it.
 */
import {
  needsYouCardCopy,
  type NeedsYouEnvironment,
  type NeedsYouItem,
} from "@t3tools/client-runtime/peer/needs-you";
import { matchesPattern } from "@t3tools/client-runtime/peer-settings";
import {
  OwnershipRpcScopes,
  PEER_OWNERSHIP_LIMITS,
  PEER_OWNERSHIP_METHODS,
  type PeerHubStatus,
  type PeerOwnershipDecideInput,
  type PeerOwnershipDecision,
} from "@t3tools/contracts";

import { agoWords, expiresWords } from "./words";

export type OwnerCallItem = Extract<NeedsYouItem, { readonly kind: "owner-call" }>;

/** A computer the phone knows, with the status it last reported. */
export type OwnerCallEnvironment = Pick<
  NeedsYouEnvironment,
  "environmentId" | "label" | "connected" | "status"
>;

/** What a button says where this pairing cannot decide: the person decides on their computer. */
export const DECIDE_ON_YOUR_COMPUTER = "Decide on your computer";

/** How many of a call's paths its card lists; the sheet lists them all. */
const CARD_PATHS = 3;

// ---- who may decide, and from where ---------------------------------------------------------

/**
 * Whether a pairing may decide a call: it holds the scope the method asks for. Owners and calls are
 * shared work, so that is operate access; a phone that may only read sees the call and is told to
 * decide on its computer.
 */
export function canDecide(scopes: ReadonlyArray<string> | null | undefined): boolean {
  return scopes?.includes(OwnershipRpcScopes[PEER_OWNERSHIP_METHODS.peerOwnershipDecide]) === true;
}

/** The ownership of the call's project as a status carries it. */
function ownershipOf(status: PeerHubStatus | null, item: OwnerCallItem) {
  return status?.ownership?.projects.find(
    (entry) => entry.workspace === item.workspace && entry.project === item.project,
  );
}

/** What the screens know of a call besides the item: where to decide it, and its project and task. */
export interface OwnerCallContext {
  /**
   * The computer to decide on: one that is connected and reports the call, the one the item came
   * from first. Undefined while none is: the decision waits for one.
   */
  readonly host: OwnerCallEnvironment | undefined;
  /** The project's name, or its id while no computer says. */
  readonly projectName: string;
  /** "ORD-9 Refund fee field", the task the call is about; undefined for a call on no task. */
  readonly task: string | undefined;
  /** The owner-decides patterns that cover the call's paths, as the owner map lists them. */
  readonly patterns: ReadonlyArray<string>;
}

/**
 * Where an owner's call is decided and what it is about. Several computers of one person read the
 * same call as one item, so the item's own computer may be away while another is connected: the
 * decision goes to a connected one that reports the call.
 */
export function ownerCallContext(
  item: OwnerCallItem,
  environments: ReadonlyArray<OwnerCallEnvironment>,
): OwnerCallContext {
  const reporting = environments.filter(
    (environment) =>
      environment.status?.signedIn === true &&
      ownershipOf(environment.status, item)?.calls.some((call) => call.id === item.call.id) ===
        true,
  );
  const connected = reporting.filter((environment) => environment.connected);
  const host =
    connected.find((environment) => environment.environmentId === item.environmentId) ??
    connected[0];
  // An away computer still knows the names.
  const source =
    host ??
    reporting.find((environment) => environment.environmentId === item.environmentId) ??
    reporting[0];
  const status = source?.status ?? null;
  const state = status?.workspaces
    .find((workspace) => workspace.slug === item.workspace)
    ?.projects.find((project) => project.project.id === item.project);
  const task = state?.work.tasks.find((candidate) => candidate.id === item.call.task);
  return {
    host,
    projectName: state?.project.name ?? item.project,
    task:
      task === undefined
        ? undefined
        : [task.key, task.title].filter((part) => part !== undefined && part !== "").join(" "),
    patterns: (ownershipOf(status, item)?.map.decide ?? []).filter((glob) =>
      item.call.paths.some((path) => matchesPattern(glob, path)),
    ),
  };
}

// ---- what the card and the sheet say --------------------------------------------------------

/**
 * What the buttons say: the owner decides ("Decide…", Accept, Decline); a lead deciding for an owner
 * who left names them ("Decide for Ana"), as the record will.
 */
export function ownerCallLabels(item: OwnerCallItem) {
  return item.onBehalf
    ? {
        entry: `Decide for ${item.owner}`,
        accept: `Accept for ${item.owner}`,
        decline: `Decline for ${item.owner}`,
      }
    : { entry: "Decide…", accept: "Accept", decline: "Decline" };
}

/** The card in Needs you: the headline, where it is, the paths, and the asking agent's words. */
export function ownerCallCardText(item: OwnerCallItem, context: OwnerCallContext, now: number) {
  const asked = agoWords(now - Date.parse(item.call.createdAt));
  const reason = item.call.reason.trim();
  return {
    title: item.title,
    context: [context.projectName, context.task].filter((part) => part !== undefined).join(" · "),
    paths: item.call.paths.slice(0, CARD_PATHS),
    morePaths: Math.max(0, item.call.paths.length - CARD_PATHS),
    quote: reason === "" ? asked : `“${reason}” · ${asked}`,
    /** For a lead deciding for an owner who left; the owner has nothing to be told. */
    guidance: item.onBehalf ? needsYouCardCopy(item).guidance : undefined,
  };
}

/** The decide sheet: the call in full, whose decision it is, and what the asking agent will hear. */
export function ownerCallSheetText(item: OwnerCallItem, context: OwnerCallContext, now: number) {
  const asker = `${item.asker}'s agent`;
  const decides =
    context.patterns.length === 0
      ? ""
      : ` ${decider(item)} changes by others in ${context.patterns.join(", ")}.`;
  return {
    title: item.title,
    subtitle: [
      context.task,
      `asked ${agoWords(now - Date.parse(item.call.createdAt))}`,
      expiresWords(Date.parse(item.call.expiresAt) - now),
    ]
      .filter((part) => part !== undefined)
      .join(" · "),
    paths: item.call.paths,
    reason: item.call.reason.trim(),
    footnote: `${asker}'s words.${decides}`,
    noteLabel: `Note for ${asker} (optional)`,
    hears: item.onBehalf
      ? `${asker} hears the answer and your note once and is woken if it is idle. The record says you decided for ${item.owner}.`
      : `${asker} hears your answer and note once and is woken if it is idle.`,
  };
}

/** Who decides changes by others in the paths: the person looking, or the owner they decide for. */
const decider = (item: OwnerCallItem) => (item.onBehalf ? `${item.owner} decides` : "You decide");

/** What the decision's controls are: their words, and whether and why they wait. */
export interface OwnerCallControls {
  readonly entry: string;
  readonly accept: string;
  readonly decline: string;
  /** Why nothing can be decided just now, in a line; null while something can. */
  readonly reason: string | null;
  /** The pairing cannot decide at all: one disabled button says where to, in place of the two. */
  readonly onYourComputer: boolean;
}

/**
 * The controls of a call as this phone and its computer allow them: it may decide only on a computer
 * that is connected, whose Hub answers, and where the pairing holds the scope. The reasons are the
 * words the overlap actions already use.
 */
export function ownerCallControls(
  item: OwnerCallItem,
  state: {
    readonly connected: boolean;
    readonly hubError: boolean;
    readonly canOperate: boolean;
  },
): OwnerCallControls {
  const reason = !state.connected
    ? "Connect this computer first."
    : state.hubError
      ? "The Peer Hub is unreachable."
      : !state.canOperate
        ? "This pairing cannot operate on this computer."
        : null;
  return {
    ...ownerCallLabels(item),
    reason,
    onYourComputer: state.connected && !state.hubError && !state.canOperate,
  };
}

// ---- what a decision sends ------------------------------------------------------------------

/** A note cut to the characters the Hub accepts, counted as it counts them: Unicode scalar values. */
export function clampNote(text: string): string {
  const characters = Array.from(text);
  return characters.length <= PEER_OWNERSHIP_LIMITS.textChars
    ? text
    : characters.slice(0, PEER_OWNERSHIP_LIMITS.textChars).join("");
}

/** "26 / 300": how much of the note is used. */
export function noteCounter(note: string): string {
  return `${Array.from(note).length} / ${PEER_OWNERSHIP_LIMITS.textChars}`;
}

/**
 * What accepting or declining sends: the call, and the note as written. An empty one sends none, so
 * the asking agent is not told a blank. The Hub records who decided, and for whom.
 */
export function ownerCallDecision(
  item: OwnerCallItem,
  decision: PeerOwnershipDecision,
  note: string,
): PeerOwnershipDecideInput {
  const said = clampNote(note.trim()).trimEnd();
  return {
    workspace: item.workspace,
    project: item.project,
    id: item.call.id,
    decision,
    ...(said === "" ? {} : { note: said }),
  };
}
