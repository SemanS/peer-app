import { EnvironmentId, type PeerHubStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { roomRowLine, roomRowsAcross, type RoomEnvironment } from "./rooms.logic";

const ENV = EnvironmentId.make("env-laptop");
const OTHER = EnvironmentId.make("env-studio");

const room = (task: string, seq: number, seen: number) => ({
  project: "orders",
  task,
  seq,
  seen,
  updated: "2026-11-01T10:00:00.000Z",
  author: { email: "ana@acme.test", run: "r1" },
});

const status = (rooms: ReadonlyArray<ReturnType<typeof room>>) =>
  ({
    signedIn: true,
    plugins: [{ id: "rooms", title: "Rooms", enabled: true, active: true }],
    workspaces: [
      {
        slug: "acme",
        projects: [
          {
            project: {
              id: "orders",
              name: "Orders",
              members: [{ email: "ana@acme.test", name: "Ana" }],
            },
            work: { tasks: [{ id: "t1", key: "ORD-1", title: "Split payments" }] },
          },
        ],
      },
    ],
    rooms: { waiting: [], mentions: [], seqs: {}, revs: {}, rooms: { acme: rooms } },
  }) as unknown as PeerHubStatus;

const computer = (
  environmentId: EnvironmentId,
  connected: boolean,
  rooms: ReadonlyArray<ReturnType<typeof room>>,
): RoomEnvironment => ({ environmentId, label: "A computer", connected, status: status(rooms) });

describe("roomRowsAcross", () => {
  it("names a room by its task and project, and who wrote last", () => {
    const [row] = roomRowsAcross([computer(ENV, true, [room("t1", 4, 1)])]);
    expect(row).toMatchObject({ title: "ORD-1 · Split payments", projectName: "Orders" });
    expect(roomRowLine(row!)).toBe("Orders · Ana's agent · 3 unread");
  });

  it("counts a room two computers report once, and a connected one answers for it", () => {
    const rows = roomRowsAcross([
      computer(OTHER, false, [room("t1", 4, 1)]),
      computer(ENV, true, [room("t1", 4, 1)]),
    ]);
    expect(rows.map((row) => row.environmentId)).toEqual([ENV]);
  });

  it("lists nothing from a computer signed out or with the plugin off", () => {
    const signedOut = computer(ENV, true, [room("t1", 4, 1)]);
    expect(
      roomRowsAcross([{ ...signedOut, status: { ...signedOut.status!, signedIn: false } }]),
    ).toEqual([]);
    expect(
      roomRowsAcross([{ ...signedOut, status: { ...signedOut.status!, plugins: [] } }]),
    ).toEqual([]);
  });
});
