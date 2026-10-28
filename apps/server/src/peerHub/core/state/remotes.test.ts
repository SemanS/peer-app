import { assert, describe, it } from "@effect/vitest";

import { matchRepositories, normalizeRemote } from "./remotes.ts";

const manifest = (slug: string, projects: Record<string, string>) => ({
  workspace: { slug },
  projects: Object.entries(projects).map(([id, url]) => ({
    id,
    repositories: [{ id: "app", url }],
  })),
});

describe("normalizeRemote", () => {
  it("reads https, ssh and scp-like forms of one repository the same", () => {
    for (const url of [
      "https://github.com/example/webshop.git",
      "https://github.com/example/webshop",
      "https://user@GitHub.com/example/webshop/",
      "http://github.com:8080/example/webshop.git",
      "ssh://git@github.com/example/webshop.git",
      "ssh://git@github.com:22/example/webshop",
      "git@github.com:example/webshop.git",
      "github.com:example/webshop",
      "git://github.com/example/webshop.git",
    ])
      assert.strictEqual(normalizeRemote(url), "github.com/example/webshop", url);
  });

  it("keeps the path's case and tells other repositories apart", () => {
    assert.strictEqual(
      normalizeRemote("git@github.com:Example/Shop.git"),
      "github.com/Example/Shop",
    );
    assert.notStrictEqual(
      normalizeRemote("git@gitlab.com:example/webshop.git"),
      normalizeRemote("git@github.com:example/webshop.git"),
    );
  });

  it("keeps a local path and refuses what is no address", () => {
    assert.strictEqual(normalizeRemote("/srv/git/webshop.git"), "file/srv/git/webshop");
    assert.strictEqual(normalizeRemote("file:///srv/git/webshop.git"), "file/srv/git/webshop");
    assert.isNull(normalizeRemote(""));
    assert.isNull(normalizeRemote("webshop"));
    assert.isNull(normalizeRemote("https://github.com/"));
  });
});

describe("matchRepositories", () => {
  it("finds the project whose repository the remote is", () => {
    assert.deepStrictEqual(
      matchRepositories("git@github.com:example/webshop.git", [
        manifest("example", {
          webshop: "https://github.com/example/webshop.git",
          billing: "https://github.com/example/billing.git",
        }),
        null,
      ]),
      [{ workspace: "example", project: "webshop", repository: "app" }],
    );
  });

  it("finds two projects that name one URL", () => {
    assert.deepStrictEqual(
      matchRepositories("https://github.com/example/webshop", [
        manifest("example", { webshop: "git@github.com:example/webshop.git" }),
        manifest("acme", { shop: "ssh://git@github.com/example/webshop.git" }),
      ]),
      [
        { workspace: "example", project: "webshop", repository: "app" },
        { workspace: "acme", project: "shop", repository: "app" },
      ],
    );
  });

  it("finds nothing for a foreign remote", () => {
    assert.deepStrictEqual(
      matchRepositories("git@github.com:someone/else.git", [
        manifest("example", { webshop: "https://github.com/example/webshop.git" }),
      ]),
      [],
    );
    assert.deepStrictEqual(matchRepositories("not a url", [manifest("example", {})]), []);
  });
});
