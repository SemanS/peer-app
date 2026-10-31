import type { PeerRoomMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { sharedRoomMembers, sharedRoomsOf, sharedTimeline } from "./sharedRoom.logic";

const task = (id: string, group?: string, status = "open") => ({
  id,
  title: `Title ${id}`,
  status,
  ...(group === undefined ? {} : { group }),
});
const status = {
  workspaces: [
    {
      slug: "acme",
      projects: [
        { project: { id: "app", name: "App" }, work: { tasks: [task("a", "g"), task("b")] } },
        {
          project: { id: "site", name: "Site" },
          work: { tasks: [task("c", "g", "done"), task("d", "g")] },
        },
      ],
    },
  ],
};

const message = (seq: number, at: string, text: string, email = "ana@x.io") =>
  ({ seq, at, text, author: { kind: "person", email }, to: [] }) as unknown as PeerRoomMessage;
const member = (project: string) => ({
  place: { workspace: "acme", project, task: `t-${project}` },
  project,
  title: "T",
});

describe("shared rooms", () => {
  it("finds a group's open chats across projects", () => {
    expect(sharedRoomMembers(status, "g").map((row) => row.place.task)).toEqual(["a", "d"]);
  });

  it("lists a shared room once for its projects", () => {
    expect(sharedRoomsOf(status, ["acme/app", "acme/site"]).map((room) => room.group)).toEqual([
      "g",
    ]);
    expect(sharedRoomsOf(status, ["acme/other"])).toEqual([]);
  });

  it("merges by time and shows words posted to both once", () => {
    const first = message(1, "2026-10-31T10:00:00Z", "Do it");
    const second = message(1, "2026-10-31T10:00:01Z", "Do it");
    const reply = message(2, "2026-10-31T10:05:00Z", "Done");
    const { messages, rows } = sharedTimeline([
      { member: member("app"), messages: [first, reply] },
      { member: member("site"), messages: [second] },
    ]);
    expect(messages).toEqual([first, second, reply]);
    expect(rows.get(first)?.echo).toBe(false);
    expect(rows.get(second)?.echo).toBe(true);
    expect(rows.get(second)?.place.project).toBe("site");
    expect(rows.get(reply)?.echo).toBe(false);
  });

  it("keeps the same words from two people apart", () => {
    const { rows } = sharedTimeline([
      { member: member("app"), messages: [message(1, "2026-10-31T10:00:00Z", "ok")] },
      { member: member("site"), messages: [message(1, "2026-10-31T10:00:01Z", "ok", "bo@x.io")] },
    ]);
    expect([...rows.values()].some((row) => row.echo)).toBe(false);
  });
});
