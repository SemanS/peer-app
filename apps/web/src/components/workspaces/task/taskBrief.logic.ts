/** What a task's description says it is: an OpenSpec import folds its bullets into `- ` lines. */
export interface TaskBrief {
  /** The text before the lines: the whole task where the title had to be cut. */
  readonly summary: string | undefined;
  readonly outcome: ReadonlyArray<string>;
  /** "Contract and decisions": what the work must hold to and build on. */
  readonly contract: ReadonlyArray<string>;
  readonly criteria: ReadonlyArray<string>;
  /** Lines with no label of their own. */
  readonly steps: ReadonlyArray<string>;
}

const LABELLED = /^(outcome|context|contract|decisions?|acceptance|verify|tests?)\s*:\s*(.+)$/i;

/** Sorts a description's lines by their label; the text stays as its author wrote it. */
export function taskBrief(description: string | undefined): TaskBrief {
  const prose: string[] = [];
  const brief = {
    outcome: [] as string[],
    contract: [] as string[],
    criteria: [] as string[],
    steps: [] as string[],
  };
  for (const line of (description ?? "").split("\n")) {
    if (!line.startsWith("- ")) {
      if (line.trim() !== "") prose.push(line.trim());
      continue;
    }
    const text = line.slice(2).trim();
    const labelled = LABELLED.exec(text);
    const label = labelled?.[1]?.toLowerCase();
    if (label === undefined) brief.steps.push(text);
    else if (label === "outcome") brief.outcome.push(labelled?.[2] ?? text);
    else if (label === "acceptance" || label === "verify" || label.startsWith("test"))
      brief.criteria.push(labelled?.[2] ?? text);
    else brief.contract.push(labelled?.[2] ?? text);
  }
  return { summary: prose.length === 0 ? undefined : prose.join("\n"), ...brief };
}

/** Whether the task has anything to show under its brief. */
export function hasBrief(brief: TaskBrief): boolean {
  return (
    brief.summary !== undefined ||
    [brief.outcome, brief.contract, brief.criteria, brief.steps].some((lines) => lines.length > 0)
  );
}
