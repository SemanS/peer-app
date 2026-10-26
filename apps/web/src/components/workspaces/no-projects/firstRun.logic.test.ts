import { describe, expect, it } from "vite-plus/test";

import { firstRunSteps } from "./firstRun.logic";

const done = (steps: ReturnType<typeof firstRunSteps>) =>
  Object.fromEntries(steps.map((step) => [step.id, step.done]));

describe("a new organization's first steps", () => {
  it("leaves every step open in an empty organization", () => {
    expect(done(firstRunSteps({ projects: 0, document: {}, people: 1, invitations: 0 }))).toEqual({
      project: false,
      people: false,
      tools: false,
      capacity: false,
    });
  });

  it("says nothing of what it has not read yet", () => {
    const steps = firstRunSteps({ projects: 0, document: null, people: null, invitations: null });
    expect(done(steps)).toEqual({ project: false, people: null, tools: null, capacity: null });
  });

  it("ticks each step from the settings and the invitations", () => {
    const document = {
      projects: { app: { name: "App" } },
      tools: { linear: { name: "Linear", transport: "http", url: "https://mcp.linear.app" } },
      capacity: { team: { name: "Team", models: [{ id: "claude" }] } },
    };
    expect(done(firstRunSteps({ projects: 0, document, people: 1, invitations: 1 }))).toEqual({
      project: true,
      people: true,
      tools: true,
      capacity: true,
    });
  });

  it("links each step to the settings page that does it", () => {
    expect(
      firstRunSteps({ projects: 0, document: {}, people: 1, invitations: 0 }).map((s) => s.section),
    ).toEqual(["new-project", "people", "tools", "capacity"]);
  });
});
