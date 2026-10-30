import type { PeerHubStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { roomNeedsCount, roomPalette, roomTaskLabel } from "./roomSlots.logic";

const need = { workspace: "w", project: "p", task: "t1", seq: 1, author: "a", text: "", at: "" };
const status = {
  signedIn: true,
  workspaces: [
    {
      slug: "w",
      projects: [
        {
          project: { id: "p", name: "Ordering" },
          work: {
            tasks: [
              { id: "t1", key: "ORD-1", title: "Darker hero" },
              { id: "t2", title: "No key" },
            ],
          },
        },
      ],
    },
  ],
  rooms: {
    waiting: [need, { ...need, seq: 2 }],
    mentions: [{ ...need, seq: 3 }],
    seqs: { w: { p: { t1: 3, gone: 9 } }, other: { p: { t1: 1 } } },
    revs: { w: { p: { t1: 3, gone: 9 } }, other: { p: { t1: 1 } } },
  },
} as unknown as PeerHubStatus;

describe("Needs you's share of the rooms", () => {
  it("counts what waits and each mention, and nothing without the plugin's status", () => {
    expect(roomNeedsCount(status)).toBe(3);
    expect(roomNeedsCount({})).toBe(0);
  });
});

describe("a task's name in Needs you", () => {
  it("is its key, else its title, else its id", () => {
    const place = { workspace: "w", project: "p" };
    expect(roomTaskLabel(status, { ...place, task: "t1" })).toBe("ORD-1");
    expect(roomTaskLabel(status, { ...place, task: "t2" })).toBe("No key");
    expect(roomTaskLabel(status, { ...place, task: "t3" })).toBe("t3");
  });
});

describe("rooms in the command palette", () => {
  it("offers the room of each task the person can see, by key and title", () => {
    const actions = roomPalette(status);
    expect(actions.map((action) => [action.value, action.title, action.description])).toEqual([
      ["action:room:w:p:t1", "Open room · ORD-1", "Ordering"],
    ]);
    expect(actions[0]?.searchTerms).toEqual(
      expect.arrayContaining(["room", "Darker hero", "ORD-1"]),
    );
  });

  it("offers nothing while signed out, or while no room is known", () => {
    expect(roomPalette({ ...status, signedIn: false })).toEqual([]);
    const { rooms: _rooms, ...none } = status;
    expect(roomPalette(none)).toEqual([]);
  });
});
