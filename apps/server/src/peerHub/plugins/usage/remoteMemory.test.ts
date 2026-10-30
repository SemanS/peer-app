// @effect-diagnostics nodeBuiltinImport:off - a real file and real directories, on purpose.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";

import { parseRemotes, printRemotes, remoteFile, remoteWhenPresent } from "./remoteMemory.ts";

let home = "";
beforeEach(async () => {
  home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "usage-remotes-"));
});
afterEach(() => NodeFSP.rm(home, { recursive: true, force: true }));

describe("the remotes file", () => {
  it("is private, and reads back what was written", async () => {
    const file = remoteFile(NodePath.join(home, "deep", "remotes.json"));
    expect(await file.read()).toBeNull();
    await file.write(printRemotes(new Map([["/work/a", "git@github.com:acme/a.git"]])));
    expect([...parseRemotes(await file.read())]).toEqual([
      ["/work/a", "git@github.com:acme/a.git"],
    ]);
    const stat = await NodeFSP.stat(NodePath.join(home, "deep", "remotes.json"));
    expect(stat.mode & 0o777).toBe(0o600);
    expect(await NodeFSP.readdir(NodePath.join(home, "deep"))).toEqual(["remotes.json"]);
  });

  it("teaches nothing when it cannot be understood", () => {
    expect(parseRemotes("not json").size).toBe(0);
    expect(parseRemotes('{"/a":1}').size).toBe(0);
    expect(parseRemotes(null).size).toBe(0);
  });

  it("is the same text whatever order it was learned in", () => {
    expect(
      printRemotes(
        new Map([
          ["/b", "b"],
          ["/a", "a"],
        ]),
      ),
    ).toBe(
      printRemotes(
        new Map([
          ["/a", "a"],
          ["/b", "b"],
        ]),
      ),
    );
  });
});

describe("a lookup", () => {
  it("costs no process for a directory that is gone, or for a file", async () => {
    const asked: Array<string> = [];
    const lookup = remoteWhenPresent((cwd) => {
      asked.push(cwd);
      return Promise.resolve("origin");
    });
    const file = NodePath.join(home, "a-file");
    await NodeFSP.writeFile(file, "");
    expect(await lookup(NodePath.join(home, "gone"))).toBeNull();
    expect(await lookup(file)).toBeNull();
    expect(asked).toEqual([]);
    expect(await lookup(home)).toBe("origin");
    expect(asked).toEqual([home]);
  });
});
