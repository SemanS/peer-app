// @effect-diagnostics globalDate:off - a pure cache with an injected epoch clock, Hub ISO timestamps and no Effects.
import type { PeerAnnouncement, PeerAnnouncementSync } from "@t3tools/contracts";
interface Entry {
  allowed: ReadonlySet<string> | undefined;
  answer: PeerAnnouncementSync | undefined;
  at: number;
  offset: number;
  unsupportedUntil: number;
  dirty: boolean;
  flight: Promise<void> | undefined;
}
export function makeCache(clock: () => number = Date.now) {
  const entries = new Map<string, Entry>();
  const entry = (workspace: string) => {
    if (!entries.has(workspace))
      entries.set(workspace, {
        allowed: undefined,
        answer: undefined,
        at: 0,
        offset: 0,
        unsupportedUntil: 0,
        dirty: false,
        flight: undefined,
      });
    return entries.get(workspace)!;
  };
  const now = (workspace: string) => clock() + entry(workspace).offset;
  const rows = (workspace: string) =>
    (entry(workspace).answer?.announcements ?? []).filter((row) =>
      row.withdrawnAt !== undefined
        ? Date.parse(row.withdrawnAt) > now(workspace) - 3600000
        : Date.parse(row.expiresAt) > now(workspace),
    );
  const withdraw = (workspace: string, ids: ReadonlyArray<string>) => {
    const state = entry(workspace);
    if (state.answer)
      state.answer = {
        ...state.answer,
        announcements: state.answer.announcements.map((row) =>
          ids.includes(row.id)
            ? { ...row, status: "withdrawn", withdrawnAt: new Date(now(workspace)).toISOString() }
            : row,
        ),
      };
  };
  const hash = (ids: string[]) => {
    let n = 2166136261;
    for (const char of ids.sort().join("|")) n = Math.imul(n ^ char.charCodeAt(0), 16777619);
    return (n >>> 0).toString(16);
  };
  return {
    now,
    rows,
    entry,
    unsupported: (workspace: string) => entry(workspace).unsupportedUntil > clock(),
    async refresh(workspace: string, load: () => Promise<PeerAnnouncementSync | null>) {
      const state = entry(workspace);
      if (state.unsupportedUntil > clock()) return;
      if (state.flight) {
        state.dirty = true;
        return state.flight;
      }
      const read = async () => {
        do {
          state.dirty = false;
          const answer = await load();
          state.answer =
            answer === null
              ? undefined
              : state.allowed === undefined
                ? answer
                : {
                    ...answer,
                    announcements: answer.announcements.filter((row) =>
                      state.allowed!.has(row.project),
                    ),
                    delivered: answer.delivered.filter((row) => state.allowed!.has(row.project)),
                  };
          state.at = clock();
          if (answer === null) {
            state.unsupportedUntil = clock() + 600000;
            break;
          }
          state.unsupportedUntil = 0;
          const hubAt = Date.parse(answer.at);
          if (Number.isFinite(hubAt)) state.offset = hubAt - clock();
        } while (state.dirty);
      };
      state.flight = read().finally(() => {
        state.flight = undefined;
      });
      return state.flight;
    },
    post(workspace: string, row: PeerAnnouncement, replaced: ReadonlyArray<string> = []) {
      const state = entry(workspace);
      state.answer ??= {
        at: new Date(now(workspace)).toISOString(),
        announcements: [],
        delivered: [],
        rejected: [],
      };
      withdraw(workspace, replaced);
      state.answer = {
        ...state.answer,
        announcements: [...state.answer.announcements.filter((old) => old.id !== row.id), row],
      };
    },
    withdraw,
    restrict(allowed: ReadonlyMap<string, ReadonlySet<string>>) {
      for (const [workspace, state] of entries) {
        const projects = allowed.get(workspace);
        state.allowed = projects;
        if (!projects) entries.delete(workspace);
        else if (state.answer)
          state.answer = {
            ...state.answer,
            announcements: state.answer.announcements.filter((row) => projects.has(row.project)),
            delivered: state.answer.delivered.filter((row) => projects.has(row.project)),
          };
      }
    },
    summary() {
      const projects: Array<{ workspace: string; project: string; active: number; rev: string }> =
        [];
      const unsupported: string[] = [];
      for (const workspace of entries.keys()) {
        if (entry(workspace).unsupportedUntil > clock()) unsupported.push(workspace);
        const active = rows(workspace).filter(
          (row) =>
            row.withdrawnAt === undefined && row.status !== "expired" && row.status !== "withdrawn",
        );
        for (const project of new Set(active.map((row) => row.project))) {
          const ids = active.filter((row) => row.project === project).map((row) => row.id);
          projects.push({ workspace, project, active: ids.length, rev: hash(ids) });
        }
      }
      return { unsupported, projects };
    },
  };
}
