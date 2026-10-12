import { describe, expect, it, vi } from "vite-plus/test";

import { EVA, statusFor } from "./ownership.testkit";
import { teamPalette } from "./teamPalette";

describe("the Team page in the command palette", () => {
  it("offers to open the Team page of each project whose ownership is known", () => {
    const actions = teamPalette(statusFor(EVA));
    expect(actions.map((action) => [action.value, action.title, action.description])).toEqual([
      ["action:team:acme:ordering", "Open Team · Ordering demo", "Acme"],
    ]);
    expect(actions[0]!.searchTerms).toEqual(expect.arrayContaining(["team", "owners"]));
  });

  it("opens the page for the project it names", async () => {
    const navigate = vi.fn();
    await teamPalette(statusFor(EVA))[0]!.run(navigate as never);
    expect(navigate).toHaveBeenCalledWith({
      to: "/team/$workspace/$project",
      params: { workspace: "acme", project: "ordering" },
      search: {},
    });
  });

  it("offers nothing where ownership is not known, or no one is signed in", () => {
    expect(teamPalette(statusFor(EVA, { ownership: null }))).toEqual([]);
    expect(teamPalette({ ...statusFor(EVA), signedIn: false })).toEqual([]);
  });
});
