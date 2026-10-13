/**
 * What the plugin decides of an agreement without asking anyone: whether a session is the one to
 * hear it, who took part in it, what counts as due for a person, what the status says of a
 * workspace's agreements, and which changes between two reads are worth a line in the log. They are
 * pure functions of the Hub's view; the service brings the clock, the people and the live sessions.
 *
 * @module peerHub/plugins/agreements/rules
 */
import type { PeerAgreement, PeerAgreementsStatus, PeerAgreementsView } from "@t3tools/contracts";

/** Who asks: the signed-in person (in lower case) and this computer's id, as the Hub knows them. */
export interface Viewer {
  readonly person: string;
  readonly environment: string;
}

/** A closed agreement stays on `peer agreements` this long. */
const CLOSED_SHOWN_MS = 14 * 86_400_000;

/** Open, due, or in a state a newer Hub names. */
export const notClosed = (agreement: PeerAgreement) => agreement.state !== "closed";

/** What a session may be told: open or due. A state a newer Hub names is not told. */
export const tellable = (agreement: PeerAgreement) =>
  agreement.state === "open" || agreement.state === "due";

/** Where a session's told set keeps an agreement; a reopened one has the same id, so it is not told twice. */
export const toldKey = (agreement: PeerAgreement) => `agreement:${agreement.id}`;

/** The other task of the pair, from one task's side; undefined for a task that is not in it. */
export const otherTask = (agreement: Pick<PeerAgreement, "tasks">, task: string) =>
  agreement.tasks.includes(task) ? agreement.tasks.find((id) => id !== task) : undefined;

/** The task that landed, of an agreement that fell due for the other. */
export const landedTask = (agreement: PeerAgreement) =>
  (agreement.dueFor === undefined ? undefined : otherTask(agreement, agreement.dueFor)) ??
  agreement.landed[0];

/** Newest settled first; the same moment falls back to the id, so the order never changes between reads. */
export const newestFirst = (a: PeerAgreement, b: PeerAgreement) =>
  (Date.parse(b.settledAt) || 0) - (Date.parse(a.settledAt) || 0) || a.id.localeCompare(b.id);

/**
 * Whether the session took part in the overlap that the agreement settled: one of its sides is this
 * session, on this computer, for this person. A session that took part is not told its own agreement.
 */
export const tookPart = (
  agreement: PeerAgreement,
  session: { readonly id: string },
  viewer: Viewer,
) =>
  agreement.sides.some(
    (side) =>
      side.session === session.id &&
      side.environment === viewer.environment &&
      side.email.toLowerCase() === viewer.person,
  );

/**
 * The open and due agreements of the session's task that it has not heard and did not take part in,
 * newest settled first: what a step or a landing step tells it.
 */
export const untold = (
  view: Pick<PeerAgreementsView, "agreements">,
  session: { readonly id: string; readonly project: string; readonly task: string },
  viewer: Viewer,
  told: ReadonlySet<string>,
) =>
  view.agreements
    .filter(
      (agreement) =>
        agreement.project === session.project &&
        tellable(agreement) &&
        agreement.tasks.includes(session.task) &&
        !told.has(toldKey(agreement)) &&
        !tookPart(agreement, session, viewer),
    )
    .toSorted(newestFirst);

/**
 * What `peer agreements` lists for a task: the agreements not closed, then those closed in the last
 * 14 days, each newest settled first.
 */
export function ofTask(
  view: Pick<PeerAgreementsView, "agreements">,
  project: string,
  task: string,
  now: number,
): ReadonlyArray<PeerAgreement> {
  const named = view.agreements.filter(
    (agreement) => agreement.project === project && agreement.tasks.includes(task),
  );
  const recent = (agreement: PeerAgreement) => {
    const at = Date.parse(agreement.closed?.at ?? "");
    return agreement.state === "closed" && Number.isFinite(at) && now - at <= CLOSED_SHOWN_MS;
  };
  return [
    ...named.filter(notClosed).toSorted(newestFirst),
    ...named.filter(recent).toSorted(newestFirst),
  ];
}

/** A task with an agent session live on it, as `sliceOf` is told which have one. */
export const liveKey = (project: string, task: string) => `${project}/${task}`;

const byIds = (a: { readonly project: string; readonly id: string }, b: typeof a) =>
  a.project.localeCompare(b.project) || a.id.localeCompare(b.id);

/**
 * What the status says of one workspace's agreements: how many are not closed, which due ones wait
 * on this person (their agent took part on the task that has not landed, and no agent is live there),
 * per task how many are not closed and how many are due for it, and every due agreement by its ids.
 * Counts and ids only; `live` holds the `liveKey` of each task with an agent on it.
 */
export function sliceOf(
  workspace: string,
  view: Pick<PeerAgreementsView, "agreements">,
  viewer: Viewer | undefined,
  live: ReadonlySet<string>,
): PeerAgreementsStatus["workspaces"][number] {
  const open = view.agreements.filter(notClosed);
  const due = open.flatMap((agreement) =>
    agreement.state === "due" && agreement.dueFor !== undefined
      ? [{ agreement, dueFor: agreement.dueFor }]
      : [],
  );
  const rows = new Map<string, { project: string; task: string; open: number; due: number }>();
  const row = (project: string, task: string) => {
    const key = liveKey(project, task);
    const found = rows.get(key) ?? { project, task, open: 0, due: 0 };
    rows.set(key, found);
    return found;
  };
  for (const agreement of open)
    for (const task of agreement.tasks) row(agreement.project, task).open += 1;
  for (const { agreement, dueFor } of due) row(agreement.project, dueFor).due += 1;
  const mine = ({ agreement, dueFor }: (typeof due)[number]) =>
    viewer !== undefined &&
    !live.has(liveKey(agreement.project, dueFor)) &&
    agreement.sides.some(
      (side) => side.task === dueFor && side.email.toLowerCase() === viewer.person,
    );
  return {
    workspace,
    open: open.length,
    dueForMe: due
      .filter(mine)
      .map(({ agreement }) => ({ project: agreement.project, id: agreement.id }))
      .toSorted(byIds),
    tasks: [...rows.values()].toSorted(
      (a, b) => a.project.localeCompare(b.project) || a.task.localeCompare(b.task),
    ),
    due: due
      .map(({ agreement, dueFor }) => ({
        project: agreement.project,
        id: agreement.id,
        dueFor,
        landed: landedTask(agreement) ?? "",
      }))
      .toSorted(byIds),
  };
}

/**
 * What changed between two reads of a workspace that the log counts: the agreements that fell due
 * (by `project/id`) and how the ones that closed were closed. A first read has no before, so it
 * counts nothing.
 */
export function transitions(
  before: ReadonlyArray<PeerAgreement> | undefined,
  after: ReadonlyArray<PeerAgreement>,
) {
  const due: string[] = [];
  const closed: string[] = [];
  if (before === undefined) return { due, closed };
  const was = new Map(
    before.map((agreement) => [`${agreement.project}/${agreement.id}`, agreement.state]),
  );
  for (const agreement of after) {
    const key = `${agreement.project}/${agreement.id}`;
    const state = was.get(key);
    if (agreement.state === "due" && state !== "due") due.push(key);
    if (agreement.state === "closed" && state !== undefined && state !== "closed")
      closed.push(agreement.closed?.why ?? "");
  }
  return { due, closed };
}
