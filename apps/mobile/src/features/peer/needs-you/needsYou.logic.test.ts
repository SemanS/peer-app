import { describe, expect, it } from "vite-plus/test";
import {
  AuthAccessWriteScope,
  EnvironmentId,
  needsYouKey,
  needsYouPushId,
  type PeerHubStatus,
} from "@t3tools/contracts";
import {
  deriveNeedsYou,
  focusItem,
  alertsControlState,
  type NeedsYouEnvironment,
} from "@t3tools/client-runtime/peer/needs-you";
import {
  alertsRowState,
  mergeNeedsYouEnvironments,
  needsYouCardCopy,
  needsYouNotice,
  overlapActionAvailability,
  requestActionState,
  shouldShowHomeRow,
} from "./needsYou.logic";
const now = Date.parse("2026-10-09T12:00:00Z"),
  environmentId = EnvironmentId.make("env");
const status = (delivery: "not-linked" | "publishing-off" | "ready" = "ready", enabled = false) =>
  ({
    signedIn: true,
    email: "person@example.test",
    error: null,
    needsYou: { alerts: { enabled, delivery }, staleInputs: [] },
    agents: { list: [{ id: "herdr:a", paneId: "a", title: "Check work", status: "blocked" }] },
    coordination: { enabled: true, overlaps: [], sessions: [] },
    workspaces: [],
    requests: [],
  }) as unknown as PeerHubStatus;
const environment = (overrides: Partial<NeedsYouEnvironment> = {}): NeedsYouEnvironment => ({
  environmentId,
  label: "Computer",
  connected: true,
  status: status(),
  threads: [],
  ...overrides,
});
describe("Needs you controls and last-known state", () => {
  it("keeps last known decisions offline and requests a clock only for an active waiting window", () => {
    const before = environment(),
      previous = new Map([[environmentId, before]]);
    const merged = mergeNeedsYouEnvironments(
      [environment({ connected: false, status: null })],
      previous,
      now,
    );
    const items = deriveNeedsYou({ environments: merged.environments, now, unseen: () => false });
    expect(items[0]).toMatchObject({ kind: "agent", offline: true, title: "Check work" });
    expect(merged.tickNeeded).toBe(false);
    const waiting = environment({
      status: {
        ...status(),
        coordination: {
          ...status().coordination,
          overlaps: [
            {
              id: "o",
              workspace: "w",
              project: "p",
              sessions: ["s"],
              state: "open",
              updatedAt: new Date(now).toISOString(),
              files: [],
              notes: [],
              policy: "ask",
            },
          ],
        },
      },
    });
    expect(mergeNeedsYouEnvironments([waiting], previous, now).tickNeeded).toBe(true);
    expect(mergeNeedsYouEnvironments([waiting], previous, now + 120_000).tickNeeded).toBe(false);
  });
  it("explains opt-in, delivery and owner permission separately", () => {
    const scopes = [AuthAccessWriteScope];
    expect(alertsControlState(null, scopes).state).toBe("hidden");
    expect(alertsControlState(status("not-linked"), scopes).explanation).toContain(
      "direct connection",
    );
    expect(alertsControlState(status("publishing-off"), scopes).state).toBe("publishing-off");
    expect(alertsControlState(status(), scopes).state).toBe("ready-off");
    expect(alertsControlState(status("ready", true), scopes).state).toBe("ready-on");
    expect(alertsControlState(status(), [])).toMatchObject({
      state: "no-permission",
      disabled: true,
    });
  });
  it("warns only for connected computers of the same signed-in person and targets the chosen computer", () => {
    const a = environment({ status: status("ready", true) }),
      other = environment({
        environmentId: EnvironmentId.make("second"),
        label: "Desktop",
        status: status("ready", true),
      });
    const state = alertsRowState(environmentId, [a, other], [AuthAccessWriteScope]);
    expect(state.duplicates).toEqual([{ environmentId: "second", label: "Desktop" }]);
    expect(state.turnOffTarget).toBe(environmentId);
    expect(
      alertsRowState(environmentId, [a, { ...other, connected: false }], [AuthAccessWriteScope])
        .duplicates,
    ).toEqual([]);
    expect(
      alertsRowState(
        environmentId,
        [a, { ...other, status: { ...status("ready", true), email: "other@example.test" } }],
        [AuthAccessWriteScope],
      ).duplicates,
    ).toEqual([]);
  });
  it.each([
    [{ connected: false, coordination: true, hubError: false, canOperate: true }, "Connect"],
    [{ connected: true, coordination: false, hubError: false, canOperate: true }, "turned off"],
    [{ connected: true, coordination: true, hubError: true, canOperate: true }, "unreachable"],
    [{ connected: true, coordination: true, hubError: false, canOperate: false }, "pairing"],
  ])("explains unavailable overlap actions", (input, reason) => {
    expect(overlapActionAvailability(input)).toMatchObject({ disabled: true });
    expect(overlapActionAvailability(input).reason).toContain(reason);
  });
  it("allows a healthy operating pairing and shows the Home row only above zero", () => {
    expect(
      overlapActionAvailability({
        connected: true,
        coordination: true,
        hubError: false,
        canOperate: true,
      }),
    ).toEqual({ disabled: false, reason: null });
    expect([0, 1, 12].map(shouldShowHomeRow)).toEqual([false, true, true]);
  });
  it("finds focused decisions and distinguishes unavailable from already handled", () => {
    const items = deriveNeedsYou({ environments: [environment()], now, unseen: () => false }),
      pushId = needsYouPushId(needsYouKey.agent(environmentId, "herdr:a"))!;
    expect(focusItem(items, pushId)).toBe(items[0]);
    expect(
      needsYouNotice({ focus: pushId, found: false, connected: false, loaded: false }),
    ).toContain("Connect");
    expect(
      needsYouNotice({ focus: pushId, found: false, connected: true, loaded: false }),
    ).toContain("Loading");
    expect(
      needsYouNotice({ focus: pushId, found: false, connected: true, loaded: true }),
    ).toContain("already been handled");
    expect(
      needsYouNotice({ focus: pushId, found: true, connected: true, loaded: true }),
    ).toBeNull();
    expect(needsYouCardCopy(items[0]!)).toEqual({
      label: "Needs input",
      guidance: "Answer it in herdr.",
    });
  });
  it.each([
    [{ kind: "thread", need: "approval" }, "Needs approval"],
    [{ kind: "thread", need: "input" }, "Needs input"],
    [{ kind: "thread", need: "review" }, "Finished"],
    [{ kind: "agent", need: "review" }, "Finished"],
    [{ kind: "request" }, "Team request"],
    [{ kind: "overlap", phase: "decide", participants: ["Alice", "Bob"] }, "Needs coordination"],
    [{ kind: "overlap", phase: "unanswered", participants: [] }, "Agreement not reached"],
    [{ kind: "stale" }, "Inputs changed"],
  ] as const)("names each kind of decision", (item, label) => {
    expect(needsYouCardCopy(item).label).toBe(label);
  });
  it("keeps every computer's blocker and never offers retry after an uncertain start", () => {
    const base = {
      kind: "request",
      computers: [
        { environmentId, label: "Laptop", connected: true, blocker: null },
        {
          environmentId: EnvironmentId.make("desktop"),
          label: "Desktop",
          connected: true,
          blocker: "No ready repository.",
        },
      ],
    };
    expect(requestActionState(base).ready.map((computer) => computer.label)).toEqual(["Laptop"]);
    expect(requestActionState(base).computers[1]?.blocker).toBe("No ready repository.");
    for (const outcome of ["accepted", "no-longer-pending", "start-not-confirmed"] as const) {
      expect(requestActionState(base, outcome).retry).toBe(false);
      expect(requestActionState(base, outcome).message).toBeTruthy();
    }
    expect(requestActionState(base, "start-not-confirmed").message).toContain(
      "Check herdr before starting another agent",
    );
  });
});
