import type { PeerHubCreateTaskInput } from "@t3tools/contracts";

/** The longest title the Hub keeps: it cuts a longer one. */
export const TASK_TITLE_MAX = 120;

/** The count shows once a title comes this close to the limit. */
const COUNT_FROM = TASK_TITLE_MAX - 20;

/** A tracker key as the Hub stores it: trimmed, in capitals. */
export const issueKey = (input: string): string => input.trim().toUpperCase();

/**
 * Why the Hub would refuse a tracker key, in the words the composer shows, or null when it takes it
 * (an empty key links nothing, which is fine). The Hub's rule: 2 to 32 characters, letters and
 * digits in parts joined by dashes.
 */
export function issueKeyProblem(input: string): string | null {
  const key = issueKey(input);
  if (key === "") return null;
  if (key.length < 2 || key.length > 32) return "A key has 2 to 32 characters, such as KRK-812.";
  if (!key.split("-").every((part) => /^[A-Z0-9]+$/.test(part))) {
    return "A key is letters and digits joined by dashes, such as KRK-812.";
  }
  return null;
}

/** A title as one line: a pasted line break becomes a space. */
export const oneLine = (input: string): string => input.replace(/\s*[\r\n]+\s*/g, " ");

/** "104 / 120" once a title nears the limit; nothing before. */
export const titleCount = (title: string): string | null =>
  title.length > COUNT_FROM ? `${title.length} / ${TASK_TITLE_MAX}` : null;

export interface AreaChoices {
  /** The project's areas that match what was typed, in the project's order. */
  readonly matches: ReadonlyArray<string>;
  /** A new area named as typed, when no area has that name yet. */
  readonly create: string | null;
}

/** The areas the picker lists for what was typed in its search field. */
export function areaChoices(areas: ReadonlyArray<string>, query: string): AreaChoices {
  const typed = query.trim();
  const needle = typed.toLowerCase();
  const matches =
    needle === "" ? [...areas] : areas.filter((area) => area.toLowerCase().includes(needle));
  const exists = areas.some((area) => area.toLowerCase() === needle);
  return { matches, create: typed === "" || exists ? null : typed };
}

/** What the composer holds before it creates a task. */
export interface NewTaskDraft {
  readonly title: string;
  /** null: no area. */
  readonly area: string | null;
  /** A tracker key, or "" for none. */
  readonly key: string;
  /** The item it goes under; null: a root. Absent on a Hub that keeps no tree. */
  readonly parent?: string | null;
}

/** A task can be created once it has a title and any key the Hub would take. */
export const canCreate = (draft: NewTaskDraft): boolean =>
  draft.title.trim() !== "" && issueKeyProblem(draft.key) === null;

/** The Hub request for a draft: the title trimmed, the key in capitals, empty parts left out. */
export function createTaskInput(
  scope: { readonly workspace: string; readonly projectId: string },
  draft: NewTaskDraft,
): PeerHubCreateTaskInput {
  const key = issueKey(draft.key);
  const area = draft.area?.trim() ?? "";
  return {
    workspace: scope.workspace,
    projectId: scope.projectId,
    title: oneLine(draft.title).trim(),
    ...(key === "" ? {} : { key }),
    ...(area === "" ? {} : { area }),
    ...(draft.parent === undefined || draft.parent === null ? {} : { parent: draft.parent }),
  };
}
