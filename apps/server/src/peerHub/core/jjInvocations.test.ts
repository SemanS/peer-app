import { describe, expect, it } from "@effect/vitest";

import { jjInvocations } from "./plugin.ts";

const only = (command: string) => {
  const runs = jjInvocations(command);
  expect(runs).toHaveLength(1);
  return runs[0]!;
};

describe("jjInvocations", () => {
  it("reads the subcommand past global options", () => {
    const run = only("jj -R ~/src/app --config ui.paginate=never git push -b feature/x");
    expect(run.command).toBe("jj git push");
    expect(run.subcommand).toEqual(["git", "push"]);
    expect(run.args).toEqual(["-b", "feature/x"]);
    expect(run.globals).toEqual([
      { name: "--repository", value: "~/src/app" },
      { name: "--config", value: "ui.paginate=never" },
    ]);
  });

  it("reads the forms of one option alike", () => {
    expect(only("jj --repository=/r log").globals).toEqual([{ name: "--repository", value: "/r" }]);
    expect(only("jj -R/r log").globals).toEqual([{ name: "--repository", value: "/r" }]);
    expect(only("jj --at-operation=@- log").globals).toEqual([{ name: "--at-op", value: "@-" }]);
    expect(only("jj --at-op abc123 log").globals).toEqual([{ name: "--at-op", value: "abc123" }]);
    expect(only("jj --config k=v squash").globals).toEqual([{ name: "--config", value: "k=v" }]);
  });

  it("finds global flags before and after the subcommand", () => {
    expect(only("jj --ignore-immutable squash").globals).toEqual([{ name: "--ignore-immutable" }]);
    const after = only("jj abandon xyz --ignore-immutable --ignore-working-copy");
    expect(after.command).toBe("jj abandon");
    expect(after.globals.map((g) => g.name)).toEqual([
      "--ignore-immutable",
      "--ignore-working-copy",
    ]);
    expect(after.args).toEqual(["xyz", "--ignore-immutable", "--ignore-working-copy"]);
  });

  it("does not take a subcommand's own options for jj's", () => {
    expect(only("jj log -r 'main..@' -n 3").globals).toEqual([]);
  });

  it("reads each jj of a compound command", () => {
    const runs = jjInvocations(
      "cd x && jj new; jj --ignore-immutable rebase -r a | cat\n(jj git fetch) && echo jj squash",
    );
    expect(runs.map((run) => run.command)).toEqual(["jj new", "jj rebase", "jj git fetch"]);
    expect(runs[1]!.globals).toEqual([{ name: "--ignore-immutable" }]);
  });

  it("reads past env, command and variable prefixes, and a path to jj", () => {
    expect(only("FOO=1 env -u X /opt/bin/jj --at-op=@ describe").command).toBe("jj describe");
    expect(only("command -p jj --ignore-immutable edit abc").globals).toEqual([
      { name: "--ignore-immutable" },
    ]);
  });

  it("skips heredoc bodies and quoted words", () => {
    expect(jjInvocations("cat <<'EOF' > f\njj --ignore-immutable squash\nEOF")).toEqual([]);
    expect(jjInvocations('echo "jj --ignore-immutable squash"')).toEqual([]);
    expect(only(`jj describe -m "it's" --ignore-immutable`).globals).toEqual([
      { name: "--ignore-immutable" },
    ]);
  });

  it("runs none for commands that are not literal jj runs", () => {
    expect(jjInvocations("command -v jj")).toEqual([]);
    expect(jjInvocations("env -S 'jj squash'")).toEqual([]);
    expect(jjInvocations("git status")).toEqual([]);
    expect(only("jj").command).toBe("");
  });
});
