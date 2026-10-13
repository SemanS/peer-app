import { canWithdraw, expiresIn, requestOutcome } from "@t3tools/client-runtime/peer/requests";
import {
  STALE_AFTER_MS,
  taskLabel,
  taskOwnership,
  taskState,
  type WorkProjectNode,
} from "@t3tools/client-runtime/peer/work";
import type { PeerAgentRequest, PeerHubStatus } from "@t3tools/contracts";
export function expiryLabel(request: PeerAgentRequest, now: number) {
  if (request.status !== "pending") return undefined;
  const text = expiresIn(request, now);
  return text === undefined
    ? undefined
    : `Expires ${text === "today" || text === "tomorrow" ? text : `in ${text}`}`;
}
export const requestRow = (request: PeerAgentRequest, email: string | null, now: number) => ({
  outcome: requestOutcome(request),
  withdraw: canWithdraw(request, email),
  expiry: expiryLabel(request, now),
});

/** How the sender reads a request's state: waiting, accepted, declined, withdrawn or expired. */
export function sentOutcome(request: PeerAgentRequest): {
  readonly label: string;
  readonly badge: "team" | "success" | "secondary";
} {
  switch (requestOutcome(request)) {
    case "pending":
      return { label: "Waiting", badge: "team" };
    case "accepted":
      return { label: "Accepted", badge: "success" };
    case "dismissed":
      return { label: "Declined", badge: "secondary" };
    case "withdrawn":
      return { label: "Withdrawn", badge: "secondary" };
    case "expired":
      return { label: "Expired", badge: "secondary" };
  }
}

// ---- the Request a teammate form -------------------------------------------------------------------

/** The longest title the Hub keeps for a request, and for the task a request brings. */
export const REQUEST_TITLE_MAX = 120;

/** A name for a person whose entry has none: "ana.novak@acme.dev" reads "Ana". */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0]?.split(/[._-]/)[0] ?? email;
  return local === "" ? email : `${local.charAt(0).toUpperCase()}${local.slice(1)}`;
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A person Request a teammate lists, and whether the Hub would deliver to them. */
export interface TeammateOption {
  readonly email: string;
  readonly name: string;
  /**
   * `project`: on the project, so the Hub delivers to them. `elsewhere`: in the workspace but not on
   * this project, which the Hub refuses ("the recipient is not on this project"), so the row is
   * shown and cannot be picked.
   */
  readonly group: "project" | "elsewhere";
  /** Their computer reported the project's work a moment ago. */
  readonly online: boolean;
}

/**
 * The people a request can go to: the project's members first, then the workspace's other members
 * (when the app has them), each group by name. The sender is never listed. `online` holds
 * lower-case addresses whose computers are reporting now (`onlineEmails`).
 */
export function teammateOptions(
  members: ReadonlyArray<{ readonly email: string; readonly name: string }>,
  me: string | null,
  more: {
    readonly elsewhere?: ReadonlyArray<{
      readonly email: string;
      readonly name?: string | null | undefined;
    }>;
    readonly online?: ReadonlySet<string>;
  } = {},
): ReadonlyArray<TeammateOption> {
  const online = more.online ?? new Set<string>();
  const seen = new Set<string>(me === null ? [] : [me.toLowerCase()]);
  const list = (
    people: ReadonlyArray<{ readonly email: string; readonly name?: string | null | undefined }>,
    group: TeammateOption["group"],
  ): ReadonlyArray<TeammateOption> =>
    people
      .flatMap((person) => {
        const key = person.email.toLowerCase();
        if (person.email.trim() === "" || seen.has(key)) return [];
        seen.add(key);
        return [
          {
            email: person.email,
            name: person.name?.trim() || nameFromEmail(person.email),
            group,
            online: online.has(key),
          },
        ];
      })
      .toSorted((a, b) => a.name.localeCompare(b.name));
  return [...list(members, "project"), ...list(more.elsewhere ?? [], "elsewhere")];
}

/** The addresses (lower-case) of the colleagues whose computers reported the project within the stale window. */
export function onlineEmails(
  peers: ReadonlyArray<{ readonly email: string; readonly seenAt: string }>,
  now: number,
): ReadonlySet<string> {
  return new Set(
    peers
      .filter((peer) => now - Date.parse(peer.seenAt) < STALE_AFTER_MS)
      .map((peer) => peer.email.toLowerCase()),
  );
}

/** Whether what the person typed finds the option, by name or address. */
export function matchesTeammate(option: TeammateOption, query: string): boolean {
  const text = query.trim().toLowerCase();
  return (
    text === "" ||
    option.name.toLowerCase().includes(text) ||
    option.email.toLowerCase().includes(text)
  );
}

/** An open task a request can name: its label as the lists write it, and where its state stands. */
export interface TaskOption {
  readonly id: string;
  readonly title: string;
  /** `KRK-812 · Split Payments`, or the title when the task has no key. */
  readonly label: string;
  /** "Not started", "In progress", "Needs your answer"… */
  readonly state: string;
}

/**
 * The project's open tasks for the picker, in the tree's order. A task that is done (the Hub's, or
 * every pull request of its chats merged) is not offered: the request would be about finished work.
 * A task in review says whose review it waits for, as every Work view does.
 */
export function taskOptions(
  project: Pick<WorkProjectNode, "areas" | "ownership">,
): ReadonlyArray<TaskOption> {
  return project.areas.flatMap((area) =>
    area.tasks.flatMap((task) => {
      const state = taskState(task, undefined, taskOwnership(project, task, area.name).review);
      return state.kind === "done"
        ? []
        : [{ id: task.id, title: task.title, label: taskLabel(task), state: state.label }];
    }),
  );
}

/** What the person chose for the task: an open one, or a new one by its title. */
export type TaskChoice =
  | { readonly kind: "existing"; readonly taskId: string }
  | { readonly kind: "new"; readonly title: string };

/**
 * The task part of the Hub's request: its `title` (an open task's own, else the new task's, which
 * the Hub gives the task it brings) and `task`, the id of the open task it names. Null while the
 * choice names nothing: no task picked (or one that is no longer open), or an empty title.
 */
export function requestTask(
  choice: TaskChoice,
  tasks: ReadonlyArray<Pick<TaskOption, "id" | "title">>,
): { readonly title: string; readonly task?: string } | null {
  if (choice.kind === "new") {
    const title = choice.title.trim();
    return title === "" ? null : { title: title.slice(0, REQUEST_TITLE_MAX) };
  }
  const task = tasks.find((candidate) => candidate.id === choice.taskId);
  const title = task?.title.trim() ?? "";
  return task === undefined || title === ""
    ? null
    : { title: title.slice(0, REQUEST_TITLE_MAX), task: task.id };
}

/**
 * The task a request just brought, read from the status the send returned: the Hub makes a task for
 * a request that names none, but answers the person with the status, not the row. It is the one new
 * request of the sender to that person with that title; none, or more than one, says nothing rather
 * than guess a task to change.
 */
export function taskBroughtBy(input: {
  /** The ids of the requests the status held before sending. */
  readonly known: ReadonlySet<string>;
  readonly after: PeerHubStatus["requests"];
  readonly workspace: string;
  readonly project: string;
  readonly sender: string | null;
  readonly recipient: string;
  readonly title: string;
}): string | undefined {
  const brought = (input.after ?? []).filter(
    ({ workspace, request }) =>
      workspace === input.workspace &&
      request.project === input.project &&
      input.sender !== null &&
      sameAddress(request.sender, input.sender) &&
      sameAddress(request.recipient, input.recipient) &&
      request.title === input.title &&
      request.task !== "" &&
      !input.known.has(request.id),
  );
  return brought.length === 1 ? brought[0]?.request.task : undefined;
}
