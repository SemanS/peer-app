import { assert, describe, it } from "@effect/vitest";

import { withProjects } from "./launcher.ts";

describe("withProjects", () => {
  it("leaves a run on one project's prompt alone", () => {
    assert.strictEqual(withProjects("Do it.", []), "Do it.");
  });

  it("names each other project's folder and that version control is per folder", () => {
    const prompt = withProjects("Do it.", [{ project: "Site", root: "/w/site-1" }]);
    assert.include(prompt, "- Site: /w/site-1");
    assert.include(prompt, "jj -R <folder>");
  });
});
