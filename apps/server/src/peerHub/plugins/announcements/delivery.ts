import type {
  PeerAnnouncement,
  PeerAnnouncementReceipt,
  PeerAnnouncementSync,
} from "@t3tools/contracts";
type Told = "prepared" | PeerAnnouncementReceipt["state"];
type Session = {
  readonly id: string;
  readonly project: string;
  readonly task: string | undefined;
  readonly status: string;
};
export const freshDelivery = () => ({
  told: new Map<string, Told>(),
  withdrawalTold: new Set<string>(),
  prepared: new Set<string>(),
  repeats: new Set<string>(),
  waking: new Set<string>(),
  hubIgnoredBefore: 0,
});
export type DeliveryState = ReturnType<typeof freshDelivery>;
const rank = { prepared: 0, offered: 1, modelInput: 2, acknowledged: 3 };
export const eligible = (row: PeerAnnouncement, session: Session, now: number) =>
  row.project === session.project &&
  row.withdrawnAt === undefined &&
  row.status !== "withdrawn" &&
  row.status !== "expired" &&
  Date.parse(row.expiresAt) > now &&
  (row.task === undefined || row.task === session.task);
export function seed(
  state: DeliveryState,
  delivered: PeerAnnouncementSync["delivered"],
  session: Session,
) {
  for (const receipt of delivered)
    if (
      receipt.session === session.id &&
      receipt.project === session.project &&
      Date.parse(receipt.offeredAt) > state.hubIgnoredBefore &&
      rank[receipt.state] > rank[state.told.get(receipt.announcement) ?? "prepared"]
    )
      state.told.set(receipt.announcement, receipt.state);
}
export function begin(state: DeliveryState, source: string, now: number) {
  for (const [id, told] of state.told) if (told === "prepared") state.told.delete(id);
  state.prepared.clear();
  state.repeats.clear();
  state.waking.clear();
  if (source === "startup" || source === "clear") {
    state.told.clear();
    state.withdrawalTold.clear();
    state.hubIgnoredBefore = now;
  }
  if (source === "compact")
    for (const [id, told] of state.told) if (told !== "prepared") state.repeats.add(id);
}
export function candidates(
  rows: ReadonlyArray<PeerAnnouncement>,
  state: DeliveryState,
  session: Session,
  now: number,
  options: { readonly waking?: boolean; readonly wake?: boolean; readonly start?: boolean } = {},
) {
  const sorted = [...rows].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),
  );
  const awake = !options.waking || (options.wake && session.status === "idle");
  return {
    active: awake
      ? sorted
          .filter(
            (row) =>
              eligible(row, session, now) &&
              !state.prepared.has(`a:${row.id}`) &&
              !state.prepared.has(`r:${row.id}`) &&
              (!state.told.has(row.id) || state.repeats.has(row.id)) &&
              (!options.waking || row.wake),
          )
          .slice(0, options.start ? 5 : 3)
      : [],
    withdrawn: options.waking
      ? []
      : sorted
          .filter(
            (row) =>
              row.project === session.project &&
              row.withdrawnAt !== undefined &&
              Date.parse(row.withdrawnAt) > now - 3600000 &&
              state.told.has(row.id) &&
              !state.withdrawalTold.has(row.id) &&
              !state.prepared.has(`w:${row.id}`),
          )
          .slice(0, 3),
  };
}
export function prepare(
  state: DeliveryState,
  active: ReadonlyArray<PeerAnnouncement>,
  withdrawn: ReadonlyArray<PeerAnnouncement>,
) {
  const refs = [
    ...active.map(
      (row) =>
        `${state.told.has(row.id) && state.told.get(row.id) !== "prepared" ? "r" : "a"}:${row.id}`,
    ),
    ...withdrawn.map((row) => `w:${row.id}`),
  ];
  for (const ref of refs) {
    state.prepared.add(ref);
    if (ref.startsWith("a:")) state.told.set(ref.slice(2), "prepared");
  }
  return refs;
}
export function confirmed(
  state: DeliveryState,
  refs: ReadonlyArray<string>,
  step: PeerAnnouncementReceipt["state"] | "dropped",
) {
  const offered: string[] = [];
  for (const ref of refs) {
    const id = ref.slice(2);
    state.prepared.delete(ref);
    if (step === "dropped") {
      if (ref.startsWith("a:") && state.told.get(id) === "prepared") state.told.delete(id);
      continue;
    }
    if (ref.startsWith("w:")) {
      state.withdrawalTold.add(id);
      continue;
    }
    state.repeats.delete(id);
    if (rank[step] > rank[state.told.get(id) ?? "prepared"]) state.told.set(id, step);
    offered.push(id);
  }
  return offered;
}
