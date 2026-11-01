import type { RoomFeedRow } from "@t3tools/client-runtime/peer/rooms";
import type { PeerHubStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { feedAuthor, feedInScope, feedSections } from "./roomFeed.logic";

const row = (over: Partial<RoomFeedRow>): RoomFeedRow => ({
  key: "w/p/t",
  workspace: "w",
  project: "p",
  task: "t",
  state: "moving",
  unread: 0,
  needs: 0,
  updated: undefined,
  author: undefined,
  ...over,
});

const status = {
  workspaces: [
    {
      slug: "w",
      projects: [{ project: { members: [{ email: "ana@acme.test", name: "Ana" }] } }],
    },
  ],
} as unknown as PeerHubStatus;

describe("feedSections", () => {
  it("heads what waits on the person first and leaves out a list with nothing in it", () => {
    const sections = feedSections([
      row({ key: "a", state: "moving" }),
      row({ key: "b", state: "yours" }),
      row({ key: "c", state: "moving" }),
    ]);
    expect(sections.map((section) => section.title)).toEqual(["Waiting on you", "Moving"]);
    expect(sections[1]?.rows.map((one) => one.key)).toEqual(["a", "c"]);
  });

  it("has no list for no rooms", () => {
    expect(feedSections([])).toEqual([]);
  });
});

describe("feedInScope", () => {
  const rows = [row({ key: "a", project: "p" }), row({ key: "b", project: "q" })];
  const keys = (shown: ReadonlyArray<RoomFeedRow>) => shown.map((one) => one.key);

  it("keeps every room for all projects, and one project's rooms for that project", () => {
    expect(keys(feedInScope(rows, { scope: "all" }))).toEqual(["a", "b"]);
    expect(keys(feedInScope(rows, { scope: "w/q" }))).toEqual(["b"]);
  });

  it("keeps the rooms of a project set's members", () => {
    const members = [{ scope: "w/p", name: "P", refs: null }];
    expect(keys(feedInScope(rows, { scope: "set:s", members }))).toEqual(["a"]);
  });
});

describe("feedAuthor", () => {
  it("names a person, their agent when a run wrote it, and nobody for a silent room", () => {
    const author = { email: "ana@acme.test" };
    expect(feedAuthor(status, row({ author }))).toBe("Ana");
    expect(feedAuthor(status, row({ author: { ...author, run: "r1" } }))).toBe("Ana's agent");
    expect(feedAuthor(status, row({}))).toBeUndefined();
  });
});
