import { describe, expect, it } from "vite-plus/test";

import { projectVcs, vcsWords } from "./vcsWords.ts";

describe("Peer's version-control words", () => {
  it("say Git's words when the kind is absent, Jujutsu's for jj", () => {
    expect(vcsWords(undefined).refNoun).toBe("branch");
    expect(vcsWords(null).workspaceNoun).toBe("worktree");
    expect(vcsWords("git").changeNoun).toBe("commit");
    expect(vcsWords("jj").refNoun).toBe("bookmark");
    expect(vcsWords("jj").workspaceNoun).toBe("workspace");
    expect(vcsWords("jj").changeNoun).toBe("change");
  });

  it("read a project as Jujutsu when one of its checkouts here is", () => {
    expect(projectVcs([])).toBe("git");
    expect(projectVcs([{}, { vcs: "git" }])).toBe("git");
    expect(projectVcs([{}, { vcs: "jj" }])).toBe("jj");
  });
});
