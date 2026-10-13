import { describe, expect, it, vi } from "vite-plus/test";

import { ANA, EVA, NOW, hubTask, minutesAgo, ownerCall, teamProject } from "./ownership.testkit";
import { teamSignals } from "./teamTile";

const REVIEWS = [
  hubTask("vl7", { title: "Receipt totals", area: "Payments", status: "review" }),
  hubTask("vl8", { title: "Tax rounding", area: "Payments", status: "review" }),
  hubTask("vl11", { title: "Menu photos", area: "Menu" }),
];

const tile = (email: string, looking = {}, now = NOW) => {
  const [signal] = teamSignals(teamProject(email, looking), now);
  return signal!;
};

describe("the Team tile", () => {
  it("is there while nothing waits on the person, with no number, like Memory's", () => {
    const signal = tile(EVA);
    expect(signal).toMatchObject({
      id: "team",
      label: "Team",
      count: null,
      detail: "Who owns what",
      tone: "team",
    });
  });

  it("counts the decisions that wait on the person: calls to them and reviews that ask them", () => {
    const calls = [ownerCall({ createdAt: minutesAgo(40) })];
    expect(tile(ANA, { ownership: { calls } }).count).toBe(1);
    expect(tile(ANA, { ownership: { calls } }).detail).toBe("1 decision waits on you");
    // Ana owns VL7, and VL8 through her area: both reviews ask her, with the call.
    const busy = tile(ANA, { tasks: REVIEWS, ownership: { calls } });
    expect(busy.count).toBe(3);
    expect(busy.detail).toBe("3 decisions wait on you");
    expect(busy.chip?.(3)).toBe("3 to decide");
  });

  it("counts only what waits on the person looking, and leaves out a call that has lapsed", () => {
    const calls = [ownerCall({ createdAt: minutesAgo(40) })];
    expect(tile(EVA, { ownership: { calls } }).count).toBeNull();
    const lapsed = [ownerCall({ expiresAt: minutesAgo(1) })];
    expect(tile(ANA, { ownership: { calls: lapsed } }).count).toBeNull();
  });

  it("is not there while ownership is not known for the project", () => {
    expect(teamSignals(teamProject(EVA, { ownership: null }), NOW)).toEqual([]);
  });

  it("opens the project's Team page", () => {
    const navigate = vi.fn();
    tile(EVA).open?.(navigate as never);
    expect(navigate).toHaveBeenCalledWith({
      to: "/team/$workspace/$project",
      params: { workspace: "acme", project: "ordering" },
      search: {},
    });
  });
});
