import { describe, expect, it } from "vite-plus/test";
import type { PeerTask, PeerWorkspaceRole, PeerWorkspaceState } from "@t3tools/contracts";

import {
  inviter,
  limitActions,
  limitWords,
  memberActions,
  ownLimit,
} from "./workspaceMembers.logic";
describe("offboarding decisions", () => {
  it("keeps members out of administration, protects owners and refuses self-removal", () => {
    expect(memberActions("member", "member", false)).toEqual({
      changeRole: false,
      remove: false,
    });
    expect(memberActions("admin", "owner", false).remove).toBe(false);
    expect(memberActions("owner", "owner", false).remove).toBe(true);
    expect(memberActions("owner", "owner", true).remove).toBe(false);
  });
});

const task = (id: string, status: PeerTask["status"], title: string) =>
  ({ id, key: id.toUpperCase(), title, status }) as PeerTask;
/** Acme as `role` sees it: Ana leads Webshop, Billing is someone else's. */
const acme = (
  role: PeerWorkspaceRole,
  leads: ReadonlyArray<string> = ["webshop"],
): Pick<PeerWorkspaceState, "role" | "projects"> =>
  ({
    role,
    projects: [
      {
        project: {
          id: "webshop",
          name: "Webshop",
          role: leads.includes("webshop") ? "lead" : "member",
        },
        work: {
          tasks: [
            task("vl7", "open", "Split payments"),
            task("vl8", "review", "Refund copy"),
            task("vl9", "done", "Old receipts"),
          ],
        },
      },
      {
        project: {
          id: "billing",
          name: "Billing",
          role: leads.includes("billing") ? "lead" : "member",
        },
        work: { tasks: [task("bl1", "open", "Invoices")] },
      },
    ],
  }) as unknown as Pick<PeerWorkspaceState, "role" | "projects">;

describe("who invites to which projects", () => {
  it("lists only the projects a lead leads, members only, and every project for an admin", () => {
    expect(inviter(acme("member"))).toEqual({
      as: "lead",
      projects: [{ id: "webshop", name: "Webshop" }],
    });
    expect(inviter(acme("admin", []))?.projects.map((project) => project.id)).toEqual([
      "webshop",
      "billing",
    ]);
    expect(inviter(acme("owner", []))?.as).toBe("admin");
    // A member who leads nothing does not invite.
    expect(inviter(acme("member", []))).toBeNull();
  });
});

describe("a member's limit", () => {
  it("is shown with the projects' names", () => {
    expect(limitWords(["webshop"], () => "Webshop")).toBe("on Webshop only");
    expect(limitWords([], () => undefined)).toBe("on no project yet");
    expect(
      limitWords(["webshop", "billing"], (id) => (id === "webshop" ? "Webshop" : undefined)),
    ).toBe("on Webshop and billing only");
  });

  it("is told to the limited member with their project's name, and to nobody else", () => {
    const workspace = acme("member");
    expect(ownLimit({ ...workspace, limitedTo: ["webshop"] })).toBe("on Webshop only");
    expect(ownLimit(workspace)).toBeUndefined();
    expect(ownLimit({ ...workspace, limitedTo: [] })).toBeUndefined();
  });

  it("is edited by an admin, and only added to, with a project they lead, by a lead", () => {
    const cyril = { role: "member" as const, projects: ["billing"] };
    expect(limitActions({ workspace: acme("admin"), member: cyril })).toEqual({
      edit: true,
      addTo: [],
    });
    // An admin also limits a member who has no limit yet.
    expect(limitActions({ workspace: acme("admin"), member: { role: "member" } }).edit).toBe(true);
    expect(limitActions({ workspace: acme("member"), member: cyril })).toEqual({
      edit: false,
      addTo: [{ id: "webshop", name: "Webshop" }],
    });
    // Already on the lead's project, or without a limit: nothing to add.
    expect(
      limitActions({ workspace: acme("member"), member: { role: "member", projects: ["webshop"] } })
        .addTo,
    ).toEqual([]);
    expect(
      limitActions({ workspace: acme("member"), member: { role: "member", projects: null } }),
    ).toEqual({ edit: false, addTo: [] });
    expect(limitActions({ workspace: acme("member", []), member: cyril }).addTo).toEqual([]);
  });
});
