import { describe, expect, it } from "@effect/vitest";
import { gitCommands, publishesWork } from "./handoffCommands.ts";

describe("publication boundary", () => {
  it("recognizes direct publication after directory and environment options", () => {
    for (const command of [
      "git push",
      "cd '/tmp/a b' && git -C . push origin HEAD",
      "env GH_HOST=x gh -R a/b pr create --title 'a'",
      "/opt/bin/git -c x=y push",
      "git status\ngit push",
      "command -- git push origin HEAD",
      "command -p env -i GH_HOST=x gh pr create",
      "env -u TOKEN -C '/tmp/a b' git push",
    ])
      expect(publishesWork(command)).toBe(true);
  });
  it("does not block discussion, inspection, or configuring push", () => {
    for (const command of [
      'echo "git push"',
      "git config alias.publish push",
      "gh pr view",
      "git pushx",
      "printf '%s' 'gh pr create'",
      "git log --grep=push",
      "command -v git push",
      "env -u git push",
    ])
      expect(publishesWork(command)).toBe(false);
  });
});

describe("what a shell line runs of git and gh", () => {
  it("names each command's subcommand, in order, past options and wrappers", () => {
    expect(gitCommands('npm test && git commit -m "fees" && git push')).toEqual([
      "git commit",
      "git push",
    ]);
    expect(
      gitCommands("env GH_HOST=x gh -R a/b pr merge 3; GIT_DIR=. git -C . -c x=y commit --amend"),
    ).toEqual(["gh pr merge", "git commit"]);
    expect(gitCommands("git --no-pager log | head; gh pr view 1")).toEqual([
      "git log",
      "gh pr view",
    ]);
  });
  it("names none for commands that only mention them", () => {
    expect(gitCommands('echo "git commit" && command -v git push && env -S "git push"')).toEqual(
      [],
    );
  });
});
