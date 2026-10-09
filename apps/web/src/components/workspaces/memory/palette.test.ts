import { describe, expect, it } from "vite-plus/test";
import { memoryPalette } from "./palette";

const status = {
  signedIn: true,
  workspaces: [{ slug: "acme", name: "Acme", projects: [{ project: { id: "app", name: "App" } }] }],
};
describe("Memory palette", () => {
  it("offers explicit company and project scopes only when signed in", async () => {
    expect(memoryPalette({ ...status, signedIn: false })).toEqual([]);
    const actions = memoryPalette(status);
    expect(actions.map(({ value }) => value)).toEqual([
      "action:memory:acme:company",
      "action:memory:acme:app",
    ]);
    const destinations: unknown[] = [];
    await actions[0]?.run(async (target) => {
      destinations.push(target);
    });
    expect(destinations).toEqual([
      {
        to: "/memory/$workspace/$project",
        params: { workspace: "acme", project: "company" },
        search: {},
      },
    ]);
  });
});
