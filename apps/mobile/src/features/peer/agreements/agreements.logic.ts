/**
 * What the agreements plugin says on the phone: a project's signal while agreements wait on the
 * person, and a task's list of agreements with what a person may do with each. Pure, so the screens
 * only draw it. What an agreement is, which state it is in and the words of each state are the
 * client runtime's (`peer/agreements`), shared with web: the Hub works the state out for the reader,
 * so nothing here judges whether a task has landed.
 *
 * Whatever the agents wrote (the words, a task's title) is teammate text: it goes into a line as
 * text and is never read as markup.
 */
import {
  agreementStateLabel,
  agreementsOfTask,
  canClose,
  canReopen,
  otherTask,
} from "@t3tools/client-runtime/peer/agreements";
import { taskLabel } from "@t3tools/client-runtime/peer/work";
import {
  AgreementsRpcScopes,
  PEER_AGREEMENTS_METHODS,
  type PeerAgreement,
  type PeerAgreementPersonReason,
  type PeerAgreementsView,
  type PeerHubStatus,
  type PeerTask,
} from "@t3tools/contracts";

import type { ProjectSignal, SignalTone } from "../slotTypes";

/** What names a task: the project's tasks, as the board lists them. */
type NamedTask = Pick<PeerTask, "id" | "key" | "title">;

/** A task as a line names it: its key, else its title; one the project no longer lists, its id. */
export function taskName(tasks: ReadonlyArray<NamedTask>, id: string): string {
  const found = tasks.find((task) => task.id === id);
  if (found === undefined) return id;
  return found.key !== undefined && found.key !== "" ? found.key : found.title;
}

/** A task as a heading names it: `KRK-1 · Order rounding`; one the project no longer lists, its id. */
function taskHeading(tasks: ReadonlyArray<NamedTask>, id: string): string {
  const found = tasks.find((task) => task.id === id);
  return found === undefined ? id : taskLabel(found);
}

// ---- the project's signal ---------------------------------------------------------------------

/**
 * The project's signal while agreements wait on the person: an agreement fell due on a task where
 * their agent took part, and no agent is live there to hear it, as the status field counts them
 * (`dueForMe`). One agreement names the two tasks, several are counted. Nothing while none waits:
 * the phone gets no notification and no Needs you item for it, so this signal is where it shows.
 */
export function agreementSignals(
  status: Pick<PeerHubStatus, "agreements">,
  project: {
    readonly workspace: string;
    readonly projectId: string;
    readonly tasks: ReadonlyArray<NamedTask>;
  },
): ReadonlyArray<ProjectSignal> {
  const row = status.agreements?.workspaces.find(
    (candidate) => candidate.workspace === project.workspace,
  );
  const waiting = row?.dueForMe.filter((due) => due.project === project.projectId) ?? [];
  const [first] = waiting;
  if (row === undefined || first === undefined) return [];
  // An older Peer sends no facts of the due ones, so a single agreement is then only counted.
  const facts = row.due?.find((due) => due.project === project.projectId && due.id === first.id);
  const detail =
    waiting.length > 1
      ? `${waiting.length} agreements wait on you`
      : facts === undefined
        ? "1 agreement waits on you"
        : `${taskName(project.tasks, facts.landed)} landed — ${taskName(project.tasks, facts.dueFor)} agreed to follow up`;
  return [
    {
      id: "agreements",
      label: waiting.length === 1 ? "Agreement due" : "Agreements due",
      icon: "doc.text",
      count: waiting.length,
      detail,
      tone: "needs",
    },
  ];
}

// ---- what closing and reopening ask of the pairing ----------------------------------------------

/**
 * Whether a pairing may close and reopen agreements: it holds the scope each method asks for. They
 * change shared work, so that is operate access; a phone that may only read sees the list.
 */
export function canChangeAgreements(scopes: ReadonlyArray<string> | null | undefined): boolean {
  return [
    PEER_AGREEMENTS_METHODS.peerAgreementsClose,
    PEER_AGREEMENTS_METHODS.peerAgreementsReopen,
  ].every((method) => scopes?.includes(AgreementsRpcScopes[method]) === true);
}

/** What a list says where a row would offer Close or Reopen but this pairing may not use them. */
export const NEEDS_OPERATE =
  "This pairing cannot operate on this computer: agreements can be read here, not closed or reopened.";

// ---- time ---------------------------------------------------------------------------------------

/**
 * How long ago a moment was: "just now", "40 min ago", "3 h ago", "2 days ago". A moment in the
 * future (a clock a little behind the Hub's) is just now; one that cannot be read has no words.
 */
export function agoWords(now: number, at: string): string {
  const then = Date.parse(at);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.floor(Math.max(0, now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

// ---- a task's agreements ---------------------------------------------------------------------------

/** What a person does with an agreement: closes it as handled or not needed, or brings it back. */
export type AgreementAction = PeerAgreementPersonReason | "reopen";

/** The two ways to close one, in the order the buttons show them. */
export const CLOSE_CHOICES: ReadonlyArray<{
  readonly why: PeerAgreementPersonReason;
  readonly label: string;
}> = [
  { why: "handled", label: "Handled" },
  { why: "not-needed", label: "Not needed" },
];

export interface AgreementRow {
  readonly id: string;
  readonly project: string;
  /** Open reads as agents' coordination, due as what waits on a person, the rest quietly. */
  readonly tone: SignalTone;
  /** "Open", "Due — KRK-1 landed", "Closed · handled by Ana": the client runtime's words. */
  readonly state: string;
  /** "With KRK-1 · Order rounding": the other task of the pair. */
  readonly heading: string;
  /** "Settled by Bob on KRK-2 · 2 days ago". */
  readonly settled: string;
  /** What the agents agreed, as they wrote it (less the blanks around it), in quotes. */
  readonly quote: string;
  /** A person can close it. */
  readonly close: boolean;
  /** A person can bring it back. */
  readonly reopen: boolean;
}

const stateTone = (state: string): SignalTone =>
  state === "open" ? "coordination" : state === "due" ? "needs" : "neutral";

export interface AgreementRowsInput {
  readonly view: Pick<PeerAgreementsView, "agreements"> | undefined;
  readonly projectId: string;
  readonly taskId: string;
  readonly tasks: ReadonlyArray<NamedTask>;
  /** A project member's name for an address. */
  readonly personLabel: (email: string) => string;
  readonly now: number;
}

/**
 * The task's agreements as its list shows them: those not closed first, then the closed ones, newest
 * settled first (the client runtime's order). A state or a reason a newer Hub names reads neutrally
 * and offers nothing; the Hub decides in the end, and answers `409` where a row is out of date.
 */
export function agreementRows(input: AgreementRowsInput): ReadonlyArray<AgreementRow> {
  const { tasks, personLabel, now } = input;
  const named = (id: string) => taskName(tasks, id);
  return agreementsOfTask(input.view, input.projectId, input.taskId).map((agreement) => {
    const other = otherTask(agreement, input.taskId);
    const who = `Settled by ${personLabel(agreement.by.email)} on ${named(agreement.by.task)}`;
    const ago = agoWords(now, agreement.settledAt);
    return {
      id: agreement.id,
      project: agreement.project,
      tone: stateTone(agreement.state),
      state: agreementStateLabel(agreement, named, personLabel),
      heading: other === undefined ? "Agreement" : `With ${taskHeading(tasks, other)}`,
      settled: ago === "" ? who : `${who} · ${ago}`,
      quote: `“${agreement.words.trim()}”`,
      close: canClose(agreement),
      reopen: canReopen(agreement, now),
    };
  });
}

/** Whether the status says the task has an agreement not closed, so its list is waited for. */
export function agreementsExpected(
  status: Pick<PeerHubStatus, "agreements">,
  workspace: string,
  projectId: string,
  taskId: string,
): boolean {
  const row = status.agreements?.workspaces.find((candidate) => candidate.workspace === workspace);
  if (row === undefined) return false;
  // An older Peer counts only the workspace: any agreement not closed may be this task's.
  if (row.tasks === undefined) return row.open > 0;
  const counts = row.tasks.find((entry) => entry.project === projectId && entry.task === taskId);
  return (counts?.open ?? 0) > 0;
}

export interface AgreementsSectionInput extends AgreementRowsInput {
  readonly status: Pick<PeerHubStatus, "agreements">;
  readonly workspace: string;
  /** Why the last read failed, when it did. */
  readonly error: string | null;
  /** This pairing holds the scopes that closing and reopening ask for. */
  readonly canChange: boolean;
}

export type AgreementsSection =
  /** Nothing to draw: the task has no agreement, or none is known. */
  | { readonly kind: "none" }
  /** The status says the task has one, and the list is on its way. */
  | { readonly kind: "loading" }
  /** The status says the task has one, and the list could not be read. */
  | { readonly kind: "failed"; readonly message: string }
  | {
      readonly kind: "list";
      readonly rows: ReadonlyArray<AgreementRow>;
      /** The last read failed; the rows are those of the one before. */
      readonly error: string | null;
      /** Why a row that could be closed or reopened is not offered, when that is why. */
      readonly note: string | null;
    };

const NONE = { kind: "none" } as const;

/**
 * What a task's section draws. It stays absent while the task has no agreement, and does not read
 * as loading or failed unless the status says there is one to wait for: most tasks have none, and a
 * Hub that is slow to answer is not news for them.
 */
export function agreementsSection(input: AgreementsSectionInput): AgreementsSection {
  const { view, error } = input;
  if (view === undefined) {
    if (!agreementsExpected(input.status, input.workspace, input.projectId, input.taskId)) {
      return NONE;
    }
    return error === null ? { kind: "loading" } : { kind: "failed", message: error };
  }
  const offered = agreementRows(input);
  if (offered.length === 0) return NONE;
  if (input.canChange) return { kind: "list", rows: offered, error, note: null };
  return {
    kind: "list",
    rows: offered.map((row) => ({ ...row, close: false, reopen: false })),
    error,
    note: offered.some((row) => row.close || row.reopen) ? NEEDS_OPERATE : null,
  };
}

// ---- what a close or a reopen leaves behind -----------------------------------------------------

/**
 * The view with the agreement as the Hub answered a close or a reopen, so the row shows where the
 * agreement stands at once instead of when the next read arrives. An agreement the view does not
 * hold is added.
 */
export function withAgreement(
  view: PeerAgreementsView,
  agreement: PeerAgreement,
): PeerAgreementsView {
  const same = (other: PeerAgreement) =>
    other.id === agreement.id && other.project === agreement.project;
  return {
    ...view,
    agreements: view.agreements.some(same)
      ? view.agreements.map((other) => (same(other) ? agreement : other))
      : [...view.agreements, agreement],
  };
}

const FAILURE_MAX = 140;

/**
 * What a failed close or reopen says under its row: the failure's own message, short, or a plain
 * line where it has none. The row stays as it was.
 */
export function failureWords(cause: unknown, action: AgreementAction): string {
  const message = cause instanceof Error ? cause.message.trim() : "";
  if (message === "") {
    return action === "reopen"
      ? "Could not reopen the agreement."
      : "Could not close the agreement.";
  }
  return message.length > FAILURE_MAX ? `${message.slice(0, FAILURE_MAX - 1).trimEnd()}…` : message;
}
