import { herdrNeedsInstall, peerLaunchBlocker } from "@t3tools/client-runtime/peer/herdr";
import { requestStartInput } from "@t3tools/client-runtime/peer/requests";
import type { PeerAgentRequest } from "@t3tools/contracts";
export const startInput = (request: PeerAgentRequest | undefined, text: string) =>
  request === undefined ? { prompt: text.trim() } : requestStartInput(request, text);

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
  names: { readonly person: (person: string, mine: boolean) => string },
): ReadonlyArray<StartFromOption> {
  const seen = new Set<string>();
  const options: Array<StartFromOption> = [];
  for (const task of tasks) {
    if (task.id === taskId || task.done) continue;
    for (const thread of task.threads) {
      const bookmark = thread.branch;
      if (thread.vcs !== "jj" || bookmark === undefined || bookmark === "" || seen.has(bookmark))
        continue;
      seen.add(bookmark);
      const label = [task.key, task.title].filter(Boolean).join(" ");
      const person = names.person(thread.person, thread.mine);
      options.push({
        value: bookmark,
        bookmark,
        title: `${person}'s change for ${task.key ?? task.title}`,
        detail: [label, person, agentLabel(thread.agent)].filter(Boolean).join(" · "),
      });
    }
  }
  return options;
}

/** The choice sent as `baseBranch`; undefined keeps the repository's own base (main). */
export const startFromBase = (choice: string | null): string | undefined => choice ?? undefined;
