/**
 * What the Operations page shows and says: whether the project's checkout here can show it, one
 * row per group of steps, the filter's choices, what the undo dialog and its result say, and the
 * read-only view of the project's changes as they were after a step. jj is read by the
 * environment; this decides nothing about the repository.
 */
import {
  agentName,
  filterOperations,
  jujutsuProblem,
  operationActor,
  operationActors,
  personName,
  undoDialog,
  type JujutsuProblemNote,
  type OperationFilter,
  type OperationGroup,
} from "@t3tools/client-runtime/peer/jujutsu";
import { projectVcs } from "@t3tools/client-runtime/peer/vcsWords";
import type {
  AtOpRow,
  JujutsuOperation,
  JujutsuState,
  UndoPreview,
  UndoResult,
} from "@t3tools/contracts";

export type OperationsPageState =
  /** The workspace does not list the project, so no checkout is known. */
  | { readonly kind: "unknown" }
  /** The checkout here is Git: the page needs a Jujutsu one. */
  | { readonly kind: "git" }
  | { readonly kind: "problem"; readonly note: JujutsuProblemNote }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "empty" }
  | { readonly kind: "ready" };

/** Which of the page's states applies; the log is only asked for while the checkout can show it. */
export function operationsPage(input: {
  readonly project:
    | {
        readonly project: { readonly id: string };
        readonly repositories: ReadonlyArray<{
          readonly vcs?: "git" | "jj" | undefined;
          readonly state: string;
        }>;
      }
    | undefined;
  readonly state: JujutsuState | undefined;
  readonly read: {
    readonly loaded: boolean;
    readonly error: string | null;
    readonly count: number;
  };
}): OperationsPageState {
  const { project } = input;
  if (project === undefined) return { kind: "unknown" };
  if (projectVcs(project.repositories.filter((repo) => repo.state === "ready")) !== "jj") {
    return { kind: "git" };
  }
  const note = jujutsuProblem(input.state, project.project.id);
  if (note !== null) return { kind: "problem", note };
  if (input.read.error !== null) return { kind: "failed", message: input.read.error };
  if (!input.read.loaded) return { kind: "loading" };
  return input.read.count === 0 ? { kind: "empty" } : { kind: "ready" };
}

/** Whether the page asks the environment for the log at all. */
export const operationsAsked = (page: OperationsPageState["kind"]) =>
  page !== "unknown" && page !== "git" && page !== "problem";

/** jj's time as the clock reads it in the canvas: `14:55:52`. */
export function clockTime(iso: string, timeZone?: string): string {
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(time);
}

/** A workspace as jj writes it, `ORD-12-3f2a1b2c@`. */
const workspaceName = (name: string) => (name.endsWith("@") ? name : `${name}@`);

export interface OperationRowView {
  /** The newest step's id: the row's identity, and what "after this step" opens. */
  readonly id: string;
  readonly time: string;
  readonly actor: {
    readonly label: string;
    readonly initial: string;
    /** `bob·codex · ORD-12-3f2a1b2c@`: the user as jj wrote it, and the workspace. */
    readonly detail: string;
  };
  readonly title: string;
  /** The commands that ran, oldest first, in jj's words. */
  readonly commands: string;
  readonly note: string | null;
  /** The step that "Undo this step…" reverts; null where the row offers none. */
  readonly undo: { readonly operation: string; readonly description: string } | null;
  readonly view: { readonly after: string; readonly before: string | null };
}

const SNAPSHOT = "snapshot working copy";

const isSnapshot = (operation: JujutsuOperation) =>
  operation.description === SNAPSHOT || operation.args.includes("util snapshot");

const changedLine = (ids: ReadonlyArray<string>) =>
  ids.length === 0
    ? null
    : `Changed ${ids.slice(0, 3).join(", ")}${ids.length > 3 ? ` and ${ids.length - 3} more` : ""}`;

/**
 * One view per group, newest first. A person's or an agent's single step can be undone; Peer's
 * own steps and its snapshots cannot, since a snapshot is only the working copy written down
 * again at the next step. `you` names the person looking, whose own steps read "Bob, you".
 */
export function operationRows(
  groups: ReadonlyArray<OperationGroup>,
  options: { readonly you: string | null; readonly timeZone?: string },
): ReadonlyArray<OperationRowView> {
  return groups.map((group, index) => {
    const newest = group.operations[0] as JujutsuOperation;
    const { actor } = group;
    const alone = group.operations.length === 1;
    const own =
      actor.kind === "person" && options.you !== null && actor.person.toLowerCase() === options.you;
    const snapshot = alone && isSnapshot(newest);
    const check = actor.kind === "peer" && actor.step === "check" && !alone;
    const note = snapshot
      ? "Peer wrote the working copy down after a tool step"
      : check
        ? `${group.operations.length} operations, shown as one. Nobody's work changed.`
        : changedLine(group.changed);
    return {
      id: group.id,
      time: clockTime(group.time, options.timeZone),
      actor: {
        label: own ? `${actor.label}, you` : actor.label,
        initial: (actor.kind === "peer" ? "P" : actor.label).charAt(0).toUpperCase(),
        detail: [
          newest.user,
          newest.workspace === undefined ? null : workspaceName(newest.workspace),
        ]
          .filter((part) => part !== null)
          .join(" · "),
      },
      title: group.title,
      commands: group.commands.join(" · "),
      note,
      undo:
        actor.kind !== "peer" && alone && !snapshot && newest.changed.length > 0
          ? { operation: newest.id, description: newest.description }
          : null,
      view: { after: group.id, before: groups[index + 1]?.id ?? null },
    };
  });
}

/** The address's local part, in lower case, which is how jj names a person's own steps. */
export const youOf = (email: string | null): string | null =>
  email === null ? null : (email.split("@")[0]?.toLowerCase() ?? null);

const ALL = "all";
const PEER = "peer";
const ACTOR = "actor:";

export interface FilterChoice {
  readonly value: string;
  readonly label: string;
}

/** The filter's choices: every step, each person or agent that took one, then Peer's own. */
export function filterChoices(
  operations: ReadonlyArray<JujutsuOperation>,
): ReadonlyArray<FilterChoice> {
  const hasPeer = operations.some((operation) => operationActor(operation.user).kind === "peer");
  return [
    { value: ALL, label: "Every step on this computer" },
    ...operationActors(operations).map(({ user, label }) => ({ value: ACTOR + user, label })),
    ...(hasPeer ? [{ value: PEER, label: "Peer's own steps" }] : []),
  ];
}

export function parseFilter(value: string): OperationFilter {
  if (value === PEER) return { kind: "peer" };
  if (value.startsWith(ACTOR)) return { kind: "actor", user: value.slice(ACTOR.length) };
  return { kind: "all" };
}

/** A filter whose choice no longer exists (its steps scrolled out of the 50) falls back to all. */
export function filterValue(value: string, choices: ReadonlyArray<FilterChoice>): string {
  return choices.some((choice) => choice.value === value) ? value : ALL;
}

export const visibleGroups = (
  groups: ReadonlyArray<OperationGroup>,
  value: string,
): ReadonlyArray<OperationGroup> => filterOperations(groups, parseFilter(value));

/** What a filtered-out list says instead of nothing. */
export const NOTHING_FOR_FILTER = "No steps match this filter.";

/** Who the dialog names: "Codex's step", "Ana's step", "your step". */
export function stepOwner(user: string, you: string | null): string {
  const actor = operationActor(user);
  if (actor.kind === "agent") return `${agentName(actor.agent)}'s step`;
  if (actor.kind === "person") {
    return you !== null && actor.person.toLowerCase() === you
      ? "your step"
      : `${personName(actor.person)}'s step`;
  }
  return "Peer's step";
}

export interface UndoDialogView {
  readonly heading: string;
  /** The step in jj's words: description, command, time and user. */
  readonly step: string;
  /** What the step did, from the changes it touched. */
  readonly did: string | null;
  readonly warning: {
    readonly title: string;
    readonly later: ReadonlyArray<{ readonly id: string; readonly line: string }>;
    readonly merge: string;
  } | null;
  readonly unread: string | null;
  readonly commands: ReadonlyArray<string>;
  readonly note: string;
  readonly confirm: string;
}

/** The undo dialog, from the preview the environment sent. */
export function undoDialogView(
  preview: UndoPreview,
  options: { readonly you: string | null; readonly timeZone?: string },
): UndoDialogView {
  const { operation } = preview;
  const dialog = undoDialog(preview);
  const actor = operationActor(operation.user);
  const touched = dialog.warning !== undefined;
  const told = actor.kind === "agent" ? ` ${agentName(actor.agent)} is told at its next step.` : "";
  return {
    heading: `Undo ${stepOwner(operation.user, options.you)}?`,
    step: [
      operation.description,
      operation.args,
      clockTime(operation.time, options.timeZone),
      operation.user,
    ].join(" · "),
    did: operation.changed.length === 0 ? null : `It changed ${operation.changed.join(", ")}.`,
    warning: touched
      ? {
          title: dialog.warning ?? "",
          later: dialog.later,
          merge: dialog.mergeNote ?? "",
        }
      : null,
    unread: dialog.unread ?? null,
    commands: dialog.commands,
    note: touched
      ? `Both steps go into the log under your name and can be undone the same way.${told}`
      : `This step goes into the log under your name and can be undone the same way.${told}`,
    confirm: touched ? "Undo and converge" : "Undo",
  };
}

/** What the page says once an undo ran, in the green line above the list. */
export function undoSummary(result: UndoResult, description: string): string {
  const parts = [`Undid "${description}"`];
  if (result.converged.length > 0) parts[0] += `, then converged ${result.converged.join(", ")}.`;
  else parts[0] += ".";
  if (result.needsPerson.length > 0) {
    parts.push(
      `${result.needsPerson.join(", ")} keeps two versions: the merge needs your choice, so both stay until you pick.`,
    );
  }
  return parts.join(" ");
}

/** A change of the "as it was" view: what it is called and what is wrong with it, if anything. */
export interface AtOpRowView {
  readonly changeId: string;
  readonly subject: string;
  readonly bookmarks: ReadonlyArray<string>;
  readonly flags: ReadonlyArray<"conflict" | "divergent" | "empty">;
  readonly paths: string;
}

export function atOpRowView(row: AtOpRow): AtOpRowView {
  const flags: Array<"conflict" | "divergent" | "empty"> = [];
  if (row.conflict) flags.push("conflict");
  if (row.divergent) flags.push("divergent");
  if (row.empty) flags.push("empty");
  return {
    changeId: row.changeId,
    subject: row.subject === "" ? "(no description)" : row.subject,
    bookmarks: row.bookmarks,
    flags,
    paths:
      row.paths.length === 0
        ? "No files"
        : `${row.paths.slice(0, 4).join(", ")}${row.paths.length > 4 ? ` and ${row.paths.length - 4} more` : ""}`,
  };
}

/** The line over the view: which moment it shows, and that nothing was changed to show it. */
export function atOpHeading(which: "after" | "before", description: string): string {
  return `The project's changes ${which === "after" ? "right after" : "just before"} "${description}". Read-only: nothing in the repository changed to show this.`;
}
