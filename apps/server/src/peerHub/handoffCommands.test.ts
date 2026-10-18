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
      "jj git push -b feature/KRK-1-ab12",
      "jj -R ~/src/app --config ui.paginate=never git push",
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
      "jj git fetch",
      "jj commit -m push",
      'echo "jj git push"',
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
  it("names jj's subcommand past its global options", () => {
    expect(
      gitCommands('npm test && jj -R ~/src/app --ignore-working-copy commit -m "x" && jj git push'),
    ).toEqual(["jj commit", "jj git push"]);
    expect(gitCommands("jj --config ui.paginate=never squash; jj --at-op=abc log")).toEqual([
      "jj squash",
      "jj log",
    ]);
    expect(gitCommands("jj --color never git --quiet push --all")).toEqual(["jj git push"]);
  });
  it("skips a heredoc's body, whatever quotes or commands it holds", () => {
    // A real agent's step: the apostrophe in "order's" once opened a quote that hid the commit.
    const written = [
      "cat > src/totals.ts <<'EOF'",
      "/** The total of an order's lines, in euros. */",
      "export const total = 1;",
      "EOF",
      'git add src && git commit -qm "Add refundFeeCents',
      "",
      'Co-Authored-By: Claude" && git log --oneline -1',
      "peer context",
    ].join("\n");
    expect(gitCommands(written)).toEqual(["git add", "git commit", "git log"]);
    expect(gitCommands("cat > notes.md <<EOF\nnext: git push && jj commit\nEOF\nls")).toEqual([]);
    expect(gitCommands('python3 - <<"PY"\nprint(1)\nPY\njj commit -m x')).toEqual(["jj commit"]);
    expect(gitCommands("cat <<-EOF > f\n\tgit push\n\tEOF\ngit status")).toEqual(["git status"]);
    expect(gitCommands("a <<A; b <<B\nbody a\nA\nbody b\nB\ngit push")).toEqual(["git push"]);
    expect(gitCommands(`grep x <<< "it's"; git commit -m y`)).toEqual(["git commit"]);
    expect(gitCommands("grep x <<< 'git push'")).toEqual([]);
  });
  it("names none for commands that only mention them", () => {
    expect(gitCommands('echo "git commit" && command -v git push && env -S "git push"')).toEqual(
      [],
    );
  });
});
