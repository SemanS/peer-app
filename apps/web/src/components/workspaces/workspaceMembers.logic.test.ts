import { describe, expect, it } from "vite-plus/test";
import type { PeerTask, PeerWorkspaceRole, PeerWorkspaceState } from "@t3tools/contracts";

import {
  invitationScope,
  inviteTaskChoices,
  inviter,
  limitActions,
  limitWords,
  memberActions,
  ownLimit,
  removalConfirmation,
  pendingRevocationsWarning,
} from "./workspaceMembers.logic";
describe("offboarding decisions", () => {
  it("keeps members out of administration, protects owners and refuses self-removal", () => {
    expect(memberActions("member", "member", false)).toEqual({
      changeRole: false,
      revokeKeys: false,
      remove: false,
    });
    expect(memberActions("admin", "owner", false).remove).toBe(false);
    expect(memberActions("owner", "owner", false).remove).toBe(true);
    expect(memberActions("owner", "owner", true).remove).toBe(false);
  });
  it("makes the full plan and lack of one explicit before consent", () => {
    const text = removalConfirmation("Acme", "bob@acme.test", {
      email: "bob@acme.test",
      role: "member",
      keys: 2,
      invites: 1,
      projects: ["kirkwood"],
      canRemove: true,
    });
    for (const phrase of [
      "2 shared-capacity keys",
      "cannot rejoin by domain",
      "kirkwood",
      "1 invitations",
      "Local clones",
    ])
      expect(text).toContain(phrase);
    expect(removalConfirmation("Acme", "bob", { unsupported: true })).toContain(
      "cannot preview the effect",
    );
    expect(removalConfirmation("Acme", "bob", { unsupported: true })).toContain(
      "may allow them to rejoin by domain",
    );
  });
  it("shows pending gateway failures until the queue is empty", () => {
    expect(pendingRevocationsWarning({ count: 2, lastError: "unreachable" })).toBe(
      "2 key revocations are waiting for the gateway (last error: unreachable).",
    );
    expect(pendingRevocationsWarning({ count: 0 })).toBeNull();
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

  it("offers the named projects' open and in-review tasks, naming the project when there are two", () => {
    expect(inviteTaskChoices(acme("member"), ["webshop"])).toEqual([
      { id: "vl7", project: "webshop", label: "VL7 Split payments" },
      { id: "vl8", project: "webshop", label: "VL8 Refund copy" },
    ]);
    expect(
      inviteTaskChoices(acme("admin"), ["webshop", "billing"]).map((choice) => choice.label),
    ).toEqual([
      "Webshop · VL7 Split payments",
      "Webshop · VL8 Refund copy",
      "Billing · BL1 Invoices",
    ]);
    expect(inviteTaskChoices(acme("admin"), [])).toEqual([]);
  });

  it("says what an invitation to named projects hands over, and what became of its task", () => {
    const names = {
      project: (id: string) => (id === "webshop" ? "Webshop" : undefined),
      task: (id: string) => (id === "vl7" ? "VL7" : undefined),
    };
    expect(invitationScope({ projects: ["webshop"], task: "vl7" }, names)).toBe(
      "On Webshop only · VL7 waits for them",
    );
    expect(
      invitationScope(
        { projects: ["webshop"], task: "vl7", taskOutcome: "taken-meanwhile" },
        names,
      ),
    ).toBe("On Webshop only · VL7 had been taken meanwhile");
    expect(
      invitationScope({ projects: ["webshop"], task: "vl7", taskOutcome: "done-meanwhile" }, names),
    ).toBe("On Webshop only · VL7 was done meanwhile");
    expect(
      invitationScope(
        { projects: ["webshop"], task: "vl7", taskOutcome: "a-newer-outcome" },
        names,
      ),
    ).toBe("On Webshop only · VL7 waits for them");
    expect(invitationScope({ projects: ["webshop", "secret"] }, names)).toBe(
      "On Webshop and secret only",
    );
    expect(invitationScope({ projects: [] }, names)).toBeNull();
    expect(invitationScope({}, names)).toBeNull();
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
