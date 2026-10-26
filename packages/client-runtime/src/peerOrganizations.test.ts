import type { PeerInvitation } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  activeOrganization,
  foundingWords,
  invitationStatus,
  invitationView,
  pendingFoundings,
  sortInvitations,
} from "./peerOrganizations.ts";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const invitation = (fields: Partial<PeerInvitation>): PeerInvitation => ({
  email: "ana@example.com",
  role: "member",
  ...fields,
});

describe("foundings", () => {
  it("lists them only while someone is signed in", () => {
    const foundings = [{ slug: "vocabulift", name: "Vocabulift" }];
    expect(pendingFoundings({ signedIn: true, foundings })).toEqual(foundings);
    expect(pendingFoundings({ signedIn: false, foundings })).toEqual([]);
    expect(pendingFoundings({ signedIn: true })).toEqual([]);
    expect(pendingFoundings(null)).toEqual([]);
  });

  it("offers an open founding and says who set it up", () => {
    const words = foundingWords(
      {
        slug: "vocabulift",
        name: "Vocabulift",
        initiatedBy: "slavo@example.com",
        expiresAt: "2026-11-09T12:00:00Z",
        expired: false,
      },
      NOW,
    );
    expect(words.title).toBe("Vocabulift is waiting for you as its owner");
    expect(words.expired).toBe(false);
    expect(words.detail).toContain("slavo@example.com set it up");
    expect(words.detail).toContain("November");
  });

  it("tells an expired one to ask for it again, by the Hub's word or its date", () => {
    expect(foundingWords({ slug: "a", name: "A", expired: true }, NOW).expired).toBe(true);
    const lapsed = foundingWords({ slug: "a", name: "A", expiresAt: "2026-10-01T00:00:00Z" }, NOW);
    expect(lapsed.expired).toBe(true);
    expect(lapsed.detail).toContain("ask the Hub's administrator to send it again");
  });
});

describe("the active organization", () => {
  const workspaces = [{ slug: "webinson" }, { slug: "vocabulift" }];
  it("is the one chosen while the person is in it, else the first", () => {
    expect(activeOrganization(workspaces, "vocabulift")?.slug).toBe("vocabulift");
    expect(activeOrganization(workspaces, "gone")?.slug).toBe("webinson");
    expect(activeOrganization(workspaces, null)?.slug).toBe("webinson");
    expect(activeOrganization([], "vocabulift")).toBeNull();
  });
});

describe("invitations", () => {
  it("reads an older Hub's invitation as pending, and a lapsed one as expired", () => {
    expect(invitationStatus(invitation({}), NOW)).toBe("pending");
    expect(invitationStatus(invitation({ expiresAt: "2026-10-01T00:00:00Z" }), NOW)).toBe(
      "expired",
    );
    expect(invitationStatus(invitation({ status: "revoked" }), NOW)).toBe("revoked");
    expect(invitationStatus(invitation({ status: "something-new" }), NOW)).toBe("pending");
  });

  it("names a failed delivery with the mail service's words and offers to send it again", () => {
    const view = invitationView(
      invitation({
        status: "pending",
        expiresAt: "2026-11-09T12:00:00Z",
        delivery: { state: "failed", attempts: 1, error: "mailbox unavailable" },
      }),
      NOW,
    );
    expect(view.label).toBe("Pending");
    expect(view.deliveryProblem).toContain("mailbox unavailable");
    expect(view.canResend && view.canRevoke).toBe(true);
  });

  it("offers nothing on one that ended", () => {
    const view = invitationView(
      invitation({ status: "revoked", at: "2026-10-20T00:00:00Z", by: "eva@example.com" }),
      NOW,
    );
    expect(view.canResend || view.canRevoke).toBe(false);
    expect(view.deliveryProblem).toBeNull();
    expect(view.detail).toContain("by eva@example.com");
  });

  it("puts failed deliveries first and ended ones last", () => {
    const sorted = sortInvitations(
      [
        invitation({ email: "done@x.com", status: "accepted" }),
        invitation({ email: "ok@x.com", status: "pending" }),
        invitation({ email: "late@x.com", status: "expired" }),
        invitation({ email: "bounce@x.com", status: "pending", delivery: { state: "failed" } }),
      ],
      NOW,
    );
    expect(sorted.map((entry) => entry.email)).toEqual([
      "bounce@x.com",
      "ok@x.com",
      "late@x.com",
      "done@x.com",
    ]);
  });
});
