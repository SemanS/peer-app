import { herdrNeedsInstall, peerLaunchBlocker } from "@t3tools/client-runtime/peer/herdr";
import { requestStartInput } from "@t3tools/client-runtime/peer/requests";
import type { PeerAgentRequest } from "@t3tools/contracts";
export const startInput = (request: PeerAgentRequest | undefined, text: string) =>
  request === undefined ? { prompt: text } : requestStartInput(request, text);

/**
 * Why the agent cannot start (the words come from client-runtime), and whether to offer the install
 * link: only where Peer has no herdr to run, not while herdr is off, starting or has failed.
 */
export function launchGuidance(
  status: Parameters<typeof peerLaunchBlocker>[0],
  project: Parameters<typeof peerLaunchBlocker>[1],
) {
  return { blocked: peerLaunchBlocker(status, project), installLink: herdrNeedsInstall(status) };
}

const HARNESS_NAME = { claude: "Claude Code", codex: "Codex" } as const;

/**
 * What an agent started here runs on: herdr agents run on the person's own login, which the
 * project's capacity policy must allow. Shared capacity for them is not offered (yet).
 */
export function capacityLine(
  project: { readonly project: { readonly capacity: { readonly personal: string } } },
  harness: keyof typeof HARNESS_NAME,
): { readonly allowed: boolean; readonly line: string } {
  return project.project.capacity.personal === "any"
    ? { allowed: true, line: `Your own ${HARNESS_NAME[harness]} login · runs only your work` }
    : {
        allowed: false,
        line: "This project's capacity policy does not let herdr agents run on your own login.",
      };
}

/** What the work tree knows of a thread, which is all "Start from" reads. */
interface StartFromThread {
  readonly key: string;
  readonly person: string;
  readonly mine: boolean;
  readonly branch: string | undefined;
  readonly vcs?: "git" | "jj" | undefined;
  readonly agent?: { readonly harness: string } | { readonly model: string } | undefined;
}

interface StartFromTask {
  readonly id: string;
  readonly key: string | undefined;
  readonly title: string;
  readonly done: boolean;
  readonly threads: ReadonlyArray<StartFromThread>;
}

export interface StartFromOption {
  /** "main" stands for the repository's own base; anything else is the bookmark sent as `baseBranch`. */
  readonly value: string;
  readonly bookmark: string | null;
  readonly title: string;
  readonly detail: string;
}

const HARNESS_LABEL: Readonly<Record<string, string>> = { claude: "Claude Code", codex: "Codex" };

const agentLabel = (agent: StartFromThread["agent"]): string | undefined =>
  agent === undefined
    ? undefined
    : "harness" in agent
      ? (HARNESS_LABEL[agent.harness] ?? agent.harness)
      : agent.model;

/**
 * The bookmarks "Start from" lists after main: other open tasks' jj threads that have one, by task,
 * person, agent and bookmark. Work-tree threads carry no change id, so none is shown; the id is
 * only ever shown for a change this computer holds, which the web cannot see without a new data path.
 */
export function startFromOptions(
  tasks: ReadonlyArray<StartFromTask>,
  taskId: string,
  /** "jj" rows are the listed choices; "other" is what the picker adds: threads on Git checkouts. */
  kind: "jj" | "other" = "jj",
): ReadonlyArray<StartFromOption> {
  const seen = new Set<string>();
  const options: Array<StartFromOption> = [];
  for (const task of tasks) {
    if (task.id === taskId || task.done) continue;
    for (const thread of task.threads) {
      const bookmark = thread.branch;
      if (bookmark === undefined || bookmark === "" || seen.has(bookmark)) continue;
      if ((thread.vcs === "jj") !== (kind === "jj")) continue;
      seen.add(bookmark);
      const label = [task.key, task.title].filter(Boolean).join(" ");
      const person = thread.person;
      options.push({
        value: bookmark,
        bookmark,
        title: `${thread.mine ? "Your" : `${person}'s`} change for ${task.key ?? task.title}`,
        detail: [label, person, agentLabel(thread.agent)].filter(Boolean).join(" · "),
      });
    }
  }
  return options;
}

/** The `Start from` choice the dialog holds: main, a listed bookmark, or "other" with its picker. */
export type StartFromChoice =
  | { readonly kind: "main" }
  | { readonly kind: "bookmark"; readonly bookmark: string }
  | { readonly kind: "other"; readonly bookmark: string | null };

/** The choice a dialog opens on: main, or the base bookmark the caller preset. */
export const presetStartFrom = (base: string | undefined): StartFromChoice =>
  base === undefined ? { kind: "main" } : { kind: "bookmark", bookmark: base };

/**
 * A preset base that no thread lists (an integration change made for this task) joins the choices
 * first, so the radio group can show what the dialog opened on.
 */
export function withPresetOption(
  options: ReadonlyArray<StartFromOption>,
  base: string | undefined,
): ReadonlyArray<StartFromOption> {
  if (base === undefined || options.some((option) => option.value === base)) return options;
  return [
    {
      value: base,
      bookmark: base,
      title: base.startsWith("peer/integrate/") ? "The integration" : "The base you chose",
      detail: base.startsWith("peer/integrate/")
        ? "Both changes, with their conflict stored in it, for this task to resolve"
        : "Made for this task",
    },
    ...options,
  ];
}

/** What is sent as `baseBranch`; undefined keeps the repository's own base (main). */
export const startFromBase = (choice: StartFromChoice): string | undefined =>
  choice.kind === "main" ? undefined : (choice.bookmark ?? undefined);

/** "Start" waits for a picked bookmark while "Another task's work in flight" is chosen. */
export const startFromReady = (choice: StartFromChoice): boolean =>
  choice.kind !== "other" || choice.bookmark !== null;

/** The line under the choices, from the canvas (artboard 2a). */
export const startFromExplanation = (choice: StartFromChoice): string =>
  choice.kind === "main"
    ? "Your agent starts from main. Peer still tells it what other tasks change that it reads, and the integration preview checks the two together."
    : choice.kind === "bookmark" || choice.bookmark !== null
      ? "Your agent sees that work before it lands, and moves with it each time it changes. It cannot rewrite that change. When it pushes, Peer tells it the base its pull request needs."
      : "Pick another task's work and your agent builds on it the same way: it moves with that change and cannot rewrite it.";
