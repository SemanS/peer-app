import type { PeerRoomMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  markedProjects,
  plannedChips,
  plannedProjects,
  roomChips,
  roomName,
  runProjectNames,
  sharedRoomOf,
  sharedRoomsOf,
  sharedTimeline,
  toggledMarks,
  type PlannedProject,
} from "./sharedRoom.logic";

const task = (id: string, group?: string, status = "open", createdAt = "2026-10-31T10:00:00Z") => ({
  id,
  title: `Title ${id}`,
  status,
  createdAt,
  ...(group === undefined ? {} : { group }),
});
const status = {
  workspaces: [
    {
      slug: "acme",
      projects: [
        {
          project: { id: "app", name: "App" },
          work: { tasks: [task("a", "g", "open", "2026-10-31T10:00:02Z"), task("b")] },
        },
        {
          project: { id: "site", name: "Site" },
          work: {
            tasks: [task("c", "g", "done"), task("d", "g", "open", "2026-10-31T10:00:01Z")],
          },
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
});

describe("shared rooms", () => {
  it("lives in the chat made first, whatever order the Hub lists its projects in", () => {
    const room = sharedRoomOf(status, "g");
    expect(room?.home.place.project).toBe("site");
    expect(room?.home.place.task).toBe("d");
    expect(room?.others.map((other) => other.place.project)).toEqual(["app"]);
  });

  it("keeps a closed chat's words, and goes on in the next chat", () => {
    const closing = {
      workspaces: [
        {
          slug: "acme",
          projects: [
            {
              project: { id: "app", name: "App" },
              work: { tasks: [task("a", "g", "done", "2026-10-31T10:00:00Z")] },
            },
            {
              project: { id: "site", name: "Site" },
              work: { tasks: [task("b", "g", "review", "2026-10-31T10:00:01Z")] },
            },
          ],
        },
      ],
    };
    const room = sharedRoomOf(closing, "g");
    expect(room?.home.place.project).toBe("site");
    expect(room?.others).toEqual([]);
    expect(room?.closed.map((chat) => chat.place.project)).toEqual(["app"]);
  });

  it("has no room once no chat of it is open", () => {
    expect(sharedRoomOf(status, "other")).toBeNull();
    const closed = {
      workspaces: [
        {
          slug: "acme",
          projects: [
            { project: { id: "app", name: "App" }, work: { tasks: [task("a", "g", "done")] } },
          ],
        },
      ],
    };
    expect(sharedRoomOf(closed, "g")).toBeNull();
  });

  it("lists a shared room once for its projects, with all of them", () => {
    const rooms = sharedRoomsOf(status, ["acme/app", "acme/site"]);
    expect(rooms.map((room) => room.group)).toEqual(["g"]);
    expect(rooms[0]?.projects.map((project) => project.name)).toEqual(["Site", "App"]);
    expect(sharedRoomsOf(status, ["acme/other"])).toEqual([]);
  });

  it("merges by time and names only what is not in the room's home", () => {
    const home = member("app");
    const first = message(1, "2026-10-31T10:00:00Z", "Do it");
    const elsewhere = message(1, "2026-10-31T10:00:01Z", "Done there");
    const reply = message(2, "2026-10-31T10:05:00Z", "Done");
    const { messages, rows } = sharedTimeline(
      [
        { member: home, messages: [first, reply] },
        { member: member("site"), messages: [elsewhere] },
      ],
      home.place,
    );
    expect(messages).toEqual([first, elsewhere, reply]);
    expect(rows.get(first)?.project).toBeUndefined();
    expect(rows.get(elsewhere)?.project).toBe("site");
    expect(rows.get(elsewhere)?.place.project).toBe("site");
  });
});

describe("what a new room reaches", () => {
  const ready = { state: "ready" as const };
  const missing = { state: "missing" as const };
  const hub = {
    workspaces: [
      {
        slug: "acme",
        projects: [
          { project: { id: "app" }, repositories: [ready] },
          { project: { id: "api" }, repositories: [missing] },
          { project: { id: "docs" }, repositories: [missing, ready] },
        ],
      },
      { slug: "other", projects: [{ project: { id: "lib" }, repositories: [ready] }] },
    ],
  };
  const scope = (name: string, key = `acme/${name}`) => ({ scope: key, name, refs: [] });
  const folderOf = ({ name }: { readonly name: string | undefined }) =>
    name === "app" || name === "api" ? null : `/w/${name}`;

  it("gives each project with a checkout here a chat", () => {
    const planned = plannedProjects([scope("app"), scope("docs")], hub, folderOf);
    expect(planned.map((project) => project.place?.project)).toEqual(["app", "docs"]);
  });

  it("keeps a project unshared on this computer as a folder", () => {
    const [, local] = plannedProjects([scope("app"), scope("site", "local:site")], hub, folderOf);
    expect(local).toEqual({ scope: "local:site", name: "site", folder: "/w/site" });
  });

  it("takes a project of another Hub workspace as a folder, as one run stays in one", () => {
    const [, lib] = plannedProjects([scope("app"), scope("lib", "other/lib")], hub, folderOf);
    expect(lib?.folder).toBe("/w/lib");
    expect(lib?.place).toBeUndefined();
  });

  it("says so of a project this computer cannot reach, rather than dropping it", () => {
    const [, api] = plannedProjects([scope("app"), scope("api")], hub, folderOf);
    expect(api?.away).toBe("This computer has no checkout of it.");
  });

  it("settles its Hub workspace on the first project with a checkout here", () => {
    const planned = plannedProjects([scope("api"), scope("lib", "other/lib")], hub, folderOf);
    expect(planned[1]?.place?.workspace).toBe("other");
  });

  const planned: ReadonlyArray<PlannedProject> = [
    { scope: "acme/app", name: "App", place: { workspace: "acme", project: "app" } },
    { scope: "acme/site", name: "Site", place: { workspace: "acme", project: "site" } },
    { scope: "local:docs", name: "Docs", folder: "/w/docs" },
    { scope: "acme/api", name: "Api", away: "This computer has no checkout of it." },
  ];

  it("marks everything it can reach until the person leaves something out", () => {
    expect(plannedChips(planned, new Set()).map((chip) => chip.marked)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    const unmarked = toggledMarks(planned, new Set(), "acme/site");
    expect(markedProjects(planned, unmarked).map((project) => project.name)).toEqual([
      "App",
      "Docs",
    ]);
    expect(toggledMarks(planned, unmarked, "acme/site").size).toBe(0);
  });

  it("keeps the last project with a chat, as the room lives there", () => {
    const left = toggledMarks(planned, new Set(), "acme/site");
    expect(toggledMarks(planned, left, "acme/app")).toBe(left);
  });
});

describe("what a running room shows", () => {
  const members = [member("kontext"), member("peer")];
  const set = {
    id: "s",
    name: "Peer stack",
    projects: ["acme/peer", "acme/kontext", "local:docs"],
  };

  it("lists the projects in the workspace's order, folders after them, all marked", () => {
    const chips = roomChips(members, ["docs"], set);
    expect(chips.map((chip) => chip.name)).toEqual(["peer", "kontext", "docs"]);
    expect(chips.every((chip) => chip.marked)).toBe(true);
    expect(chips.map((chip) => chip.folder)).toEqual([false, false, true]);
  });

  it("leaves unmarked a project its agent cannot reach from here, and says why", () => {
    const away = "This computer has no checkout of it.";
    const chips = roomChips([member("peer"), { ...member("kontext"), away }], [], set);
    expect(chips.map((chip) => [chip.name, chip.marked, chip.away])).toEqual([
      ["peer", true, undefined],
      ["kontext", false, away],
    ]);
  });

  it("lists a project shared since it joined as a folder once", () => {
    const chips = roomChips(members, ["peer", "docs"], set);
    expect(chips.map((chip) => chip.name)).toEqual(["peer", "kontext", "docs"]);
  });

  it("is named after its workspace, else after its projects", () => {
    const chips = roomChips(members, [], undefined);
    expect(roomName(set, chips)).toBe("Peer stack");
    expect(roomName(undefined, chips)).toBe("kontext + peer");
  });

  it("names a run's projects, its own first, and none for a run in one project", () => {
    expect(runProjectNames("peer", ["kontext", "docs"], members)).toEqual([
      "peer",
      "kontext",
      "docs",
    ]);
    expect(runProjectNames("peer", undefined, members)).toEqual([]);
    expect(runProjectNames("peer", [], members)).toEqual([]);
  });
});
