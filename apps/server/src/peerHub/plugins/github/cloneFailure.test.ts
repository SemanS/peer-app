import { assert, describe, it } from "@effect/vitest";

import { explainGitHubCloneFailure } from "./cloneFailure.ts";

const GITHUB = { url: "https://github.com/acme/app", branch: "main" };

describe("explainGitHubCloneFailure", () => {
  const target = { ...GITHUB, nameWithOwner: "acme/app", account: "ana-dev", cli: true };
  const notFound =
    "remote: Repository not found.\nfatal: repository 'https://github.com/acme/app.git/' not found";

  it("names the GitHub account that may not open a private repository", () => {
    const failure = explainGitHubCloneFailure(notFound, target);
    assert.isTrue(failure.signIn);
    assert.include(failure.message, "GitHub account ana-dev cannot open acme/app");
  });

  it("asks to connect GitHub, or to install GitHub CLI first", () => {
    const prompt =
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled";
    assert.include(
      explainGitHubCloneFailure(prompt, { ...target, account: null }).message,
      "Connect GitHub",
    );
    assert.include(
      explainGitHubCloneFailure(prompt, { ...target, account: null, cli: false }).message,
      "brew install gh",
    );
  });

  it("explains other failures as any clone", () => {
    const failure = explainGitHubCloneFailure(
      "fatal: Remote branch krk-812 not found in upstream origin",
      { ...target, branch: "krk-812" },
    );
    assert.isFalse(failure.signIn);
    assert.include(failure.message, 'no branch "krk-812"');
  });
});
