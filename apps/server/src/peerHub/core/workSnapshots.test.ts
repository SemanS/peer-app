// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off - temporary repositories, the real jj and its one-second timestamps.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { fetchPins, readPin } from "../plugins/rooms/client/snapshots.ts";
import { messageKey, pinWork, sealWork, snapshotPrefix } from "./workSnapshots.ts";

const hasJj = NodeChildProcess.spawnSync("jj", ["--version"]).status === 0;
const place = { workspace: "w", project: "p", task: "t" };
const AT = "2026-10-31T12:00:00.000Z";

describe.skipIf(!hasJj)("kept states of an agent's work", () => {
  let scratch: string;
  let root: string;
  const env = { ...process.env, JJ_USER: "Peer Test", JJ_EMAIL: "test@example.com" };
  const jj = (...args: ReadonlyArray<string>) =>
    NodeChildProcess.execFileSync("jj", [...args], {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
      env,
    });
  const write = (name: string, text: string) =>
    NodeFS.writeFileSync(NodePath.join(root, name), text);
  const gitDir = () => NodePath.join(root, ".git");
  const keep = async (seq: number) => {
    const sealed = await sealWork(root, AT);
    expect(sealed).not.toBeNull();
    expect(await pinWork(sealed!, place, messageKey(seq))).toBe(true);
    return sealed!;
  };
  const patch = async (seq: number) => {
    const pin = await readPin(gitDir(), place, messageKey(seq));
    return pin?.diff.state === "here" ? pin.diff.patch : "";
  };

  beforeEach(() => {
    scratch = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-kept-")));
    root = NodePath.join(scratch, "repo");
    NodeFS.mkdirSync(root);
    jj("git", "init", "--colocate");
    write("base.txt", "trunk\n");
    jj("commit", "-m", "trunk");
    jj("bookmark", "create", "main", "-r", "@-");
    NodeChildProcess.execFileSync("git", [
      "init",
      "--bare",
      "-q",
      NodePath.join(scratch, "origin"),
    ]);
    jj("git", "remote", "add", "origin", NodePath.join(scratch, "origin"));
    NodeChildProcess.execFileSync("git", ["--git-dir", gitDir(), "push", "-q", "origin", "main"]);
    jj("git", "fetch");
    jj("config", "set", "--repo", 'revset-aliases."trunk()"', "main@origin");
  });

  afterEach(() => NodeFS.rmSync(scratch, { recursive: true, force: true }));

  it("snapshot A stays what it was after snapshot B", async () => {
    write("a.txt", "one\n");
    await keep(1);
    const first = await patch(1);
    expect(first).toContain("+one");

    write("a.txt", "one\ntwo\n");
    write("b.txt", "other\n");
    await keep(2);

    expect(await patch(1)).toBe(first);
    expect(await patch(2)).toContain("b.txt");
    expect(await patch(1)).not.toContain("b.txt");
  });

  it("stays after a rebase, an abandon and a gc", async () => {
    write("a.txt", "one\n");
    jj("describe", "-m", "the work");
    await keep(1);
    const first = await patch(1);
    const work = jj("log", "--no-graph", "-r", "@", "-T", "change_id");

    jj("new", "main");
    write("trunk-moved.txt", "moved\n");
    jj("commit", "-m", "elsewhere");
    jj("rebase", "-s", work, "-d", "@-");
    jj("abandon", work);
    jj("op", "abandon", "..@-");
    jj("util", "gc", "--expire", "now");

    expect(await patch(1)).toBe(first);
  });

  it("is cumulative over the agent's changes, and leaves out what it builds on", async () => {
    write("mate.txt", "theirs\n");
    jj("describe", "-m", "mate");
    jj("metaedit", "--author", "Mate <mate@example.com>");
    jj("new");
    write("a.txt", "one\n");
    jj("commit", "-m", "first of mine");
    write("b.txt", "two\n");
    await keep(1);

    const pin = await readPin(gitDir(), place, messageKey(1));
    expect(pin?.files).toBe(2);
    expect(pin?.changes).toHaveLength(2);
    expect(await patch(1)).not.toContain("mate.txt");
  });

  it("tells a second agent of one person from the first by when its run started", async () => {
    write("first.txt", "first agent\n");
    jj("commit", "-m", "the first agent's change");
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    const since = new Date().toISOString();

    const before = await sealWork(root, AT, since);
    await pinWork(before!, place, messageKey(1));
    expect((await readPin(gitDir(), place, messageKey(1)))?.files).toBe(0);

    write("second.txt", "second agent\n");
    jj("commit", "-m", "the second agent's change");
    write("third.txt", "still working\n");
    const after = await sealWork(root, AT, since);
    await pinWork(after!, place, messageKey(2));
    const pin = await readPin(gitDir(), place, messageKey(2));
    expect(pin?.files).toBe(2);
    expect(await patch(2)).not.toContain("first.txt");
  });

  it("holds nothing when the agent changed nothing", async () => {
    await keep(1);
    const pin = await readPin(gitDir(), place, messageKey(1));
    expect(pin?.files).toBe(0);
    expect(pin?.changes).toEqual([]);
  });

  it("never moves a pin, and answers nothing where none was kept", async () => {
    write("a.txt", "one\n");
    await keep(1);
    const first = await patch(1);
    write("a.txt", "changed\n");
    const later = await sealWork(root, AT);
    expect(await pinWork(later!, place, messageKey(1))).toBe(false);
    expect(await patch(1)).toBe(first);
    expect(await readPin(gitDir(), place, messageKey(9))).toBeNull();
    expect(await readPin(gitDir(), place, "--help")).toBeNull();
  });

  it("reaches another computer's clone through origin", async () => {
    write("a.txt", "one\n");
    await keep(1);
    const first = await patch(1);
    const pins = `${snapshotPrefix(place)}/*`;
    NodeChildProcess.execFileSync("git", [
      "--git-dir",
      gitDir(),
      "push",
      "-q",
      "origin",
      `${pins}:${pins}`,
    ]);

    const other = NodePath.join(scratch, "other");
    NodeChildProcess.execFileSync("git", ["clone", "-q", NodePath.join(scratch, "origin"), other]);
    const store = NodePath.join(other, ".git");
    expect(await readPin(store, place, messageKey(1))).toBeNull();
    expect(await fetchPins(store, place, 1_000_000)).toBe(true);
    const pin = await readPin(store, place, messageKey(1));
    expect(pin?.diff.state === "here" && pin.diff.patch).toBe(first);
  });
});
