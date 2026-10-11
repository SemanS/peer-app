import { setAt } from "@t3tools/client-runtime/peer-settings";
import { describe, expect, it } from "vite-plus/test";

import { countChanges, draftSets } from "./settingsDraft.logic";
import {
  BRANCH_PROBLEM,
  CREDENTIALS_PROBLEM,
  URL_PROBLEM,
  addRepository,
  branchProblem,
  cloneView,
  githubChecksOn,
  hasCredentials,
  hostOf,
  isGitHubUrl,
  isRepositoryId,
  newRepositoryProblems,
  prVerification,
  removeRepository,
  repositoriesOf,
  repositoryIdFromUrl,
  setRepositoryBranch,
  shortUrl,
  uniqueRepositoryId,
} from "./projectRepositories.logic";

describe("reading the list", () => {
  it("reads the repositories that have an id, an address and a branch", () => {
    expect(
      repositoriesOf([
        { id: "api", url: "https://github.com/acme/api", branch: "main", extra: true },
        { id: "broken", url: "https://github.com/acme/broken" },
        "api",
        null,
      ]),
    ).toEqual([{ id: "api", url: "https://github.com/acme/api", branch: "main" }]);
    expect(repositoriesOf(undefined)).toEqual([]);
  });
});

describe("what an address and an id may be", () => {
  it("takes the ids the Hub takes", () => {
    for (const id of ["app", "booking-api", "a1-b2", "x".repeat(48)]) {
      expect(isRepositoryId(id)).toBe(true);
    }
    for (const id of ["", "App", "-app", "app-", "a--b", "a_b", "x".repeat(49)]) {
      expect(isRepositoryId(id)).toBe(false);
    }
  });

  it("finds a password or token in an address", () => {
    expect(hasCredentials("https://user:secret@github.com/acme/app")).toBe(true);
    expect(hasCredentials("https://ghp_token@github.com/acme/app")).toBe(true);
    expect(hasCredentials("ssh://user:secret@host/app")).toBe(true);
    expect(hasCredentials("ssh://git@github.com/acme/app.git")).toBe(false);
    expect(hasCredentials("git@github.com:acme/app.git")).toBe(false);
    expect(hasCredentials("https://github.com/acme/app")).toBe(false);
    expect(hasCredentials("/Users/ana/app")).toBe(false);
  });
});

describe("where an address is hosted", () => {
  it.each([
    ["https://github.com/acme/app.git", "github.com"],
    ["HTTPS://GitHub.com/acme/app", "github.com"],
    ["https://user@github.com/acme/app", "github.com"],
    ["https://github.com:443/acme/app", "github.com"],
    ["ssh://git@github.com/acme/app.git", "github.com"],
    ["git@github.com:acme/app.git", "github.com"],
    ["github.com:acme/app", "github.com"],
    ["github.com/acme/app", "github.com"],
    ["https://gitlab.com/acme/legacy-sync.git", "gitlab.com"],
    ["https://github.com@evil.example/app", "evil.example"],
    ["https://github.com.evil.example/app", "github.com.evil.example"],
    ["evil.example:github.com/app", "evil.example"],
  ])("reads the host of %s", (url, host) => {
    expect(hostOf(url)).toBe(host);
  });

  it("has no host for a path", () => {
    expect(hostOf("/Users/ana/app")).toBeNull();
    expect(hostOf("file:///srv/git/app.git")).toBeNull();
  });

  it("calls only github.com GitHub", () => {
    expect(isGitHubUrl("https://github.com/acme/app")).toBe(true);
    expect(isGitHubUrl("git@github.com:acme/app.git")).toBe(true);
    expect(isGitHubUrl("https://github.com.evil.example/acme/app")).toBe(false);
    expect(isGitHubUrl("https://notgithub.com/acme/app")).toBe(false);
    expect(isGitHubUrl("https://gitlab.com/acme/app")).toBe(false);
  });

  it("shows an address without https:// and .git", () => {
    expect(shortUrl("https://github.com/acme/booking-api")).toBe("github.com/acme/booking-api");
    expect(shortUrl("https://github.com/acme/booking-api.git/")).toBe(
      "github.com/acme/booking-api",
    );
    expect(shortUrl("git@github.com:acme/app.git")).toBe("git@github.com:acme/app");
    expect(shortUrl("http://git.acme.dev/app")).toBe("http://git.acme.dev/app");
  });
});

describe("the id a new repository gets", () => {
  it.each([
    ["https://gitlab.com/acme/legacy-sync.git", "legacy-sync"],
    ["https://github.com/acme/booking-api", "booking-api"],
    ["https://github.com/acme/booking-api/", "booking-api"],
    ["git@github.com:acme/Booking_API.git", "booking-api"],
    ["ssh://git@gitlab.com/acme/legacy-sync.git", "legacy-sync"],
    ["gitlab.com:legacy.git", "legacy"],
    ["https://github.com/acme/App.v2.git?ref=x", "app-v2"],
    ["/Users/ana/code/my app", "my-app"],
    ["", "repository"],
    ["https://github.com/acme/%%%", "repository"],
  ])("derives the id of %s as %s", (url, id) => {
    expect(repositoryIdFromUrl(url)).toBe(id);
  });

  it("makes ids the Hub takes, however long the name is", () => {
    const id = repositoryIdFromUrl(`https://github.com/acme/${"very-long-name-".repeat(10)}`);
    expect(isRepositoryId(id)).toBe(true);
    expect(id.length).toBeLessThanOrEqual(36);
    expect(isRepositoryId(repositoryIdFromUrl("https://github.com/acme/Ünïcode"))).toBe(true);
  });

  it("keeps an id the project does not have", () => {
    expect(uniqueRepositoryId("api", ["web"])).toBe("api");
  });

  it("numbers an id the project has already", () => {
    expect(uniqueRepositoryId("api", ["api"])).toBe("api-2");
    expect(uniqueRepositoryId("api", ["api", "api-2", "api-3"])).toBe("api-4");
    expect(uniqueRepositoryId("api", ["api", "api-3"])).toBe("api-2");
    expect(isRepositoryId(uniqueRepositoryId("x".repeat(36), ["x".repeat(36)]))).toBe(true);
  });
});

describe("checking the form", () => {
  it("says nothing of an address not typed yet, and is not ready", () => {
    expect(newRepositoryProblems({ url: "  ", branch: "main" })).toEqual({
      url: null,
      branch: null,
      ready: false,
    });
  });

  it("is ready with a safe address and a plain branch", () => {
    expect(
      newRepositoryProblems({ url: " https://gitlab.com/acme/legacy-sync.git ", branch: " main " }),
    ).toEqual({ url: null, branch: null, ready: true });
  });

  it("says why an address cannot be cloned", () => {
    expect(newRepositoryProblems({ url: "ext::sh -c id", branch: "main" })).toEqual({
      url: URL_PROBLEM,
      branch: null,
      ready: false,
    });
    expect(newRepositoryProblems({ url: "acme/app", branch: "main" }).url).toBe(URL_PROBLEM);
  });

  it("keeps passwords and tokens out of an address", () => {
    expect(
      newRepositoryProblems({ url: "https://ana:pw@github.com/acme/app", branch: "main" }),
    ).toEqual({
      url: CREDENTIALS_PROBLEM,
      branch: null,
      ready: false,
    });
  });

  it("says why a branch will not do", () => {
    expect(
      newRepositoryProblems({ url: "https://github.com/acme/app", branch: "--orphan" }),
    ).toEqual({
      url: null,
      branch: BRANCH_PROBLEM,
      ready: false,
    });
    expect(branchProblem("  ")).toBe("Give the branch a name.");
    expect(branchProblem("release/2026")).toBeNull();
  });
});

describe("changing the list", () => {
  const list = [
    { id: "api", url: "https://github.com/acme/api", branch: "main", note: "kept" },
    { id: "web", url: "https://github.com/acme/web", branch: "main" },
  ];

  it("adds a repository at the end, trimmed", () => {
    expect(
      addRepository(list, {
        id: "legacy",
        url: " https://gitlab.com/acme/legacy.git ",
        branch: " main ",
      }),
    ).toEqual([
      ...list,
      { id: "legacy", url: "https://gitlab.com/acme/legacy.git", branch: "main" },
    ]);
    expect(addRepository(undefined, { id: "a", url: "/a", branch: "b" })).toEqual([
      { id: "a", url: "/a", branch: "b" },
    ]);
  });

  it("removes a repository by its id", () => {
    expect(removeRepository(list, "api")).toEqual([list[1]]);
    expect(removeRepository(list, "missing")).toEqual(list);
  });

  it("changes a repository's branch and keeps what else its element holds", () => {
    expect(setRepositoryBranch(list, "api", " release/2026 ")).toEqual([
      { id: "api", url: "https://github.com/acme/api", branch: "release/2026", note: "kept" },
      list[1],
    ]);
  });
});

describe("pull requests and clones", () => {
  const status = (verification: unknown) => ({ github: { verification } }) as never;

  it("reads whether the workspace has GitHub checks on", () => {
    expect(githubChecksOn(status([{ workspace: "acme", configured: true }]), "acme")).toBe(true);
    expect(githubChecksOn(status([{ workspace: "acme", configured: false }]), "acme")).toBe(false);
    expect(githubChecksOn(status([{ workspace: "other", configured: true }]), "acme")).toBe(false);
    expect(githubChecksOn(status(undefined), "acme")).toBe(false);
  });

  it("verifies a pull request only on github.com with GitHub checks on", () => {
    expect(prVerification("https://github.com/acme/app", true)).toBe("verified");
    expect(prVerification("https://github.com/acme/app", false)).toBe("reported");
    expect(prVerification("https://gitlab.com/acme/app", true)).toBe("reported");
  });

  it("says where a repository stands on this computer", () => {
    expect(cloneView({ state: "ready", projectId: "p1" })).toEqual({ kind: "cloned" });
    expect(cloneView({ state: "ready" })).toEqual({ kind: "open" });
    expect(cloneView({ state: "cloning" })).toEqual({ kind: "cloning" });
    expect(cloneView({ state: "missing" })).toEqual({ kind: "clone", error: undefined });
    expect(cloneView({ state: "error", error: "no access" })).toEqual({
      kind: "clone",
      error: "no access",
    });
    expect(cloneView(undefined)).toEqual({ kind: "unsaved" });
  });
});

describe("what the draft saves", () => {
  const slice = ["projects", "booking"] as const;
  const path = ["projects", "booking", "repositories"];
  const list = [
    { id: "api", url: "https://github.com/acme/api", branch: "main" },
    { id: "web", url: "https://github.com/acme/web", branch: "main" },
  ];
  const base = { projects: { booking: { name: "Booking", repositories: list } } };
  const draftOf = (next: ReadonlyArray<unknown>) => setAt(base, path, next);

  it("saves an added repository as the list with it last, one change", () => {
    const next = addRepository(list, {
      id: "legacy",
      url: "https://gitlab.com/acme/legacy.git",
      branch: "main",
    });
    expect(countChanges(base, draftOf(next), slice)).toBe(1);
    expect(draftSets(base, draftOf(next), slice)).toEqual([{ path, value: next }]);
  });

  it("counts a new branch and a removal as one change each", () => {
    expect(
      countChanges(base, draftOf(setRepositoryBranch(list, "api", "release/2026")), slice),
    ).toBe(1);
    expect(countChanges(base, draftOf(removeRepository(list, "web")), slice)).toBe(1);
  });

  it("has nothing to save once a branch is put back", () => {
    const there = setRepositoryBranch(list, "api", "release/2026");
    expect(countChanges(base, draftOf(setRepositoryBranch(there, "api", "main")), slice)).toBe(0);
  });
});
