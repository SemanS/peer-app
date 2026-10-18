import {
  changeRowModel,
  changesPage,
  reviewAgainLine,
  taskStack,
  waitsForYou,
  type ChangesPageModel,
  type WaitsForYou,
} from "@t3tools/client-runtime/peer/changes";
import { jujutsuProblem } from "@t3tools/client-runtime/peer/jujutsu";
import type {
  ChangeRow,
  PeerHubStatus,
  ProjectChanges,
  ReviewDiff,
  ReviewDiffInput,
} from "@t3tools/contracts";

/** What the phone says about itself, in one place so a test can hold it to the spec. */
export const CHANGES_WORDS = {
  heading: "Changes",
  readOnly:
    "Read-only on the phone. Undo and resolve run on the computer that holds the change. Conflicts between changes are on the integration preview.",
  twoVersionsNote: "Converge runs on the computer that holds the change.",
  loadingRead: "Reading changes…",
  retry: "Retry",
  review: "Review",
  hideReview: "Hide",
} as const;

/** A project of the status that has a Changes section. */
export interface ChangesProject {
  readonly workspace: string;
  readonly workspaceName: string;
  readonly projectId: string;
  readonly name: string;
  /** Email to display name, from the project's members. */
  readonly names: Readonly<Record<string, string>>;
}

/**
 * The projects that get a Changes section: those the environment counts changes for, and those whose
 * checkout is a jj repository jj cannot read (the section then says what to fix). A Git project the
 * environment has no changes for gets nothing.
 */
export function changesProjects(status: PeerHubStatus): ReadonlyArray<ChangesProject> {
  const counted = new Set(
    (status.changes?.projects ?? []).map((entry) => `${entry.workspace}/${entry.project}`),
  );
  return status.workspaces.flatMap((workspace) =>
    workspace.projects.flatMap((state) => {
      const projectId = state.project.id;
      const jjProblem =
        state.repositories.some(
          (repository) => repository.vcs === "jj" || repository.unsupported,
        ) && jujutsuProblem(status.jujutsu, projectId) !== null;
      if (!counted.has(`${workspace.slug}/${projectId}`) && !jjProblem) return [];
      return [
        {
          workspace: workspace.slug,
          workspaceName: workspace.name,
          projectId,
          name: state.project.name,
          names: Object.fromEntries(
            state.project.members.map((member) => [member.email, member.name]),
          ),
        },
      ];
    }),
  );
}

/** The project's name, with its workspace's where the computer is in several. */
export const changesHeading = (status: PeerHubStatus, project: ChangesProject): string =>
  status.workspaces.length > 1 ? `${project.workspaceName} · ${project.name}` : project.name;

/** One change in the lists, in the canvas's words: "Eva · Claude Code · working". */
export interface PhoneChangeRow {
  readonly changeId: string;
  /** "ORD-14 Totals include VAT"; the subject alone for a change no task names. */
  readonly title: string;
  readonly idPre: string;
  readonly idRest: string;
  readonly line: string;
}

/** The state words of a row. They state what is, never what a forecast expects. */
const STATE_WORDS: Readonly<Record<string, string>> = {
  working: "working",
  review: "waits for your review",
  conflict: "conflict",
  twoVersions: "two versions",
};

function phoneRow(
  row: ChangeRow,
  all: ReadonlyArray<ChangeRow>,
  context: Parameters<typeof changeRowModel>[2],
): PhoneChangeRow {
  const model = changeRowModel(row, all, context);
  const states = model.badges.map((badge) =>
    badge.id === "buildsOn"
      ? `${badge.label.charAt(0).toLowerCase()}${badge.label.slice(1)}`
      : (STATE_WORDS[badge.id] ?? badge.label.toLowerCase()),
  );
  return {
    changeId: model.changeId,
    title: model.key === undefined ? model.title : `${model.key} ${model.title}`,
    idPre: model.id.pre,
    idRest: model.id.rest,
    line: [model.who, ...(states.length === 0 ? ["idle"] : states)].join(" · "),
  };
}

export interface PhoneWait {
  readonly kind: WaitsForYou["kind"];
  readonly changeId: string;
  readonly text: string;
  /** For a review: "2 versions since you marked v5 reviewed · order.js". */
  readonly detail: string | null;
  /** Only a review opens on the phone; a conflict or two versions is for the computer. */
  readonly canReview: boolean;
  /** "since" once the person marked a version; the whole change before. */
  readonly diffMode: ReviewDiffInput["mode"];
}

export type PhoneChangesModel =
  | Exclude<ChangesPageModel, { readonly kind: "ready" | "empty" }>
  | { readonly kind: "readFailed"; readonly message: string }
  | { readonly kind: "empty"; readonly title: string; readonly body: string }
  | {
      readonly kind: "ready";
      readonly summary: string;
      readonly waits: ReadonlyArray<PhoneWait>;
      /** "In flight · 4". */
      readonly inFlightHeading: string;
      readonly rows: ReadonlyArray<PhoneChangeRow>;
      readonly twoVersions: Extract<ChangesPageModel, { readonly kind: "ready" }>["twoVersions"];
      readonly problems: Extract<ChangesPageModel, { readonly kind: "ready" }>["problems"];
    };

/**
 * What a project's Changes section shows: the page model's honest states (jj missing, too old or
 * not colocated with the fix, an older Hub, loading, a jj failure) and, with changes, what waits
 * for the person above the changes in flight. A failed read says so only while no view arrived;
 * a view already on screen stays.
 */
export function phoneChangesModel(input: {
  readonly status: PeerHubStatus;
  readonly project: ChangesProject;
  readonly view: ProjectChanges | undefined;
  readonly error: string | null;
  readonly now: number;
}): PhoneChangesModel {
  const { status, project, view, error, now } = input;
  const me = status.email;
  const page = changesPage({
    project: project.projectId,
    now,
    me,
    names: project.names,
    jujutsu: status.jujutsu,
    hubSupport: status.changes?.hubSupport,
    view,
  });
  if (page.kind === "loading" && error !== null) return { kind: "readFailed", message: error };
  if (page.kind === "empty") {
    return { kind: "empty", title: page.title, body: page.body };
  }
  if (page.kind !== "ready") return page;
  if (view === undefined) return { kind: "readFailed", message: CHANGES_WORDS.loadingRead };

  const marks = view.marks;
  const context = { me, marks, now, names: project.names };
  const rowOf = (changeId: string) => view.changes.find((row) => row.changeId === changeId);
  const waits = waitsForYou(view.changes, { me, marks }).map((wait): PhoneWait => {
    const row = rowOf(wait.changeId);
    return {
      kind: wait.kind,
      changeId: wait.changeId,
      text: wait.text,
      detail: row === undefined || wait.kind !== "review" ? null : reviewAgainLine(row, marks),
      canReview: wait.kind === "review",
      diffMode: marks.some((mark) => mark.changeId === wait.changeId) ? "since" : "whole",
    };
  });
  return {
    kind: "ready",
    summary: page.summary,
    waits,
    inFlightHeading: `In flight · ${view.changes.length}`,
    rows: view.changes.map((row) => phoneRow(row, view.changes, context)),
    twoVersions: page.twoVersions,
    problems: page.problems,
  };
}

/** "Waits for you · 1". */
export const waitsHeading = (count: number): string => `Waits for you · ${count}`;

/** One line of a task's stack on the task page. */
export interface PhoneStackRow {
  readonly changeId: string;
  readonly title: string;
  readonly who: string;
  readonly line: string;
  readonly readOnly: boolean;
}

export type PhoneTaskChanges =
  | { readonly kind: "none" }
  | { readonly kind: "jj"; readonly title: string; readonly body: string; readonly fix: string }
  | { readonly kind: "stack"; readonly rows: ReadonlyArray<PhoneStackRow> };

/**
 * A task's changes: its own change and those it builds on down to trunk, read-only. Nothing at all
 * while no change reports the task, so a Git task page stays as it was.
 */
export function phoneTaskChanges(input: {
  readonly status: PeerHubStatus;
  readonly project: ChangesProject;
  readonly taskKey: string;
  readonly view: ProjectChanges | undefined;
  readonly now: number;
}): PhoneTaskChanges {
  const { status, project, view, now } = input;
  const note = jujutsuProblem(status.jujutsu, project.projectId);
  if (note !== null) return { kind: "jj", title: note.title, body: note.body, fix: note.fix };
  if (view === undefined) return { kind: "none" };
  const stack = taskStack(view, input.taskKey, { me: status.email, now });
  if (stack.entries.length === 0) return { kind: "none" };
  const context = { me: status.email, marks: view.marks, now, names: project.names };
  return {
    kind: "stack",
    rows: stack.entries.map((entry) => {
      const row = phoneRow(entry.change, view.changes, context);
      const moved = entry.movedAgo === undefined ? "" : ` · moved ${entry.movedAgo}`;
      return {
        changeId: row.changeId,
        title: row.title,
        who: row.line,
        line: `${entry.versions} ${entry.versions === 1 ? "version" : "versions"}${moved}`,
        readOnly: entry.readOnly,
      };
    }),
  };
}

export interface PhoneReviewDiff {
  readonly notes: ReadonlyArray<string>;
  readonly files: ReadonlyArray<{ readonly path: string; readonly stat: string }>;
}

/** What a review shows on the phone: the files that moved and an honest note when the compare is partial. */
export function phoneReviewDiff(diff: ReviewDiff): PhoneReviewDiff {
  const notes: string[] = [];
  if (diff.state === "notHere") {
    notes.push("The newest version is not on this computer, so nothing is compared.");
  } else if (diff.state === "partial" && diff.toVersion !== undefined) {
    notes.push(`Compared up to v${diff.toVersion}, the newest this computer has.`);
  }
  if (diff.leftOut !== undefined && diff.leftOut > 0) {
    notes.push(
      `${diff.leftOut} ${diff.leftOut === 1 ? "commit" : "commits"} trunk gained in between are left out.`,
    );
  }
  const files = diff.files.map((file) => ({
    path: file.path,
    stat: [file.added > 0 ? `+${file.added}` : "", file.removed > 0 ? `−${file.removed}` : ""]
      .filter((part) => part.length > 0)
      .join(" "),
  }));
  if (diff.state === "ok" && files.length === 0) notes.push("Nothing moved.");
  return { notes, files };
}
