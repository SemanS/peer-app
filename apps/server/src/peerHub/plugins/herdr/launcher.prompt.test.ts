import { assert, describe, it } from "@effect/vitest";

import { withDirs, withProjects } from "./launcher.ts";

describe("withProjects", () => {
  it("leaves a run on one project's prompt alone", () => {
    assert.strictEqual(withProjects("Do it.", []), "Do it.");
  });

  it("names each other project's folder and that version control is per folder", () => {
    const prompt = withProjects("Do it.", [{ project: "Site", root: "/w/site-1" }]);
    assert.include(prompt, "- Site: /w/site-1");
    assert.include(prompt, "jj -R <folder>");
    assert.include(prompt, "AGENTS.md or CLAUDE.md");
  });

  it("has Claude Code read the instructions of added folders", () => {
    assert.deepStrictEqual(withDirs({ A: "1" }, []), { A: "1" });
    assert.strictEqual(withDirs({}, ["/w/site"]).CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD, "1");
  });
});
