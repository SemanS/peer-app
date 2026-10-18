import { describe, expect, it } from "vite-plus/test";

import { forecastAdviceText } from "./forecastSection.logic";

const status = {
  workspaces: [
    {
      slug: "team",
      projects: [
        { project: { id: "api" }, repositories: [{ vcs: "jj" as const }] },
        { project: { id: "web" }, repositories: [{}] },
      ],
    },
  ],
};

describe("forecastAdviceText", () => {
  it("speaks of committed tips for a Git project and for one this computer no longer lists", () => {
    expect(forecastAdviceText(status, [{ workspace: "team", project: "web" }])).toBe(
      "Advice from committed tips.",
    );
    expect(forecastAdviceText(status, [{ workspace: "team", project: "gone" }])).toBe(
      "Advice from committed tips.",
    );
  });
  it("speaks of bookmarked changes for a jj project", () => {
    expect(forecastAdviceText(status, [{ workspace: "team", project: "api" }])).toBe(
      "Advice from bookmarked changes.",
    );
  });
  it("names both when the pairs span a Git and a jj project", () => {
    expect(
      forecastAdviceText(status, [
        { workspace: "team", project: "api" },
        { workspace: "team", project: "web" },
      ]),
    ).toBe("Advice from committed tips and bookmarked changes.");
  });
});
