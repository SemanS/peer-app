import type { PeerHubStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { dismissHubCard, hubCardStage, hubSidebarEntry, hubSignInStage } from "./hubSignIn.logic";

type Status = Pick<PeerHubStatus, "signedIn" | "workspaces" | "foundings">;

const workspace = { slug: "acme", name: "Acme" } as PeerHubStatus["workspaces"][number];
const founding = { slug: "vocabulift", name: "Vocabulift" } as NonNullable<
  PeerHubStatus["foundings"]
>[number];

const signedOut: Status = { signedIn: false, workspaces: [] };
const noOrganization: Status = { signedIn: true, workspaces: [] };
const member: Status = { signedIn: true, workspaces: [workspace] };

describe("hubSignInStage", () => {
  it("walks from connecting through sign-in and the organization choice to in", () => {
    expect(hubSignInStage(null)).toBe("connecting");
    expect(hubSignInStage(signedOut)).toBe("sign-in");
    expect(hubSignInStage(noOrganization)).toBe("choose");
    expect(hubSignInStage(member)).toBe("in");
  });

  it("asks for a choice while an organization founded for the person waits", () => {
    expect(hubSignInStage({ ...member, foundings: [founding] })).toBe("choose");
  });
});

describe("hubSidebarEntry", () => {
  it("offers sign-in or a choice, and leaves the line to the organization once there is one", () => {
    expect(hubSidebarEntry(null)).toBeNull();
    expect(hubSidebarEntry(signedOut)).toBe("sign-in");
    expect(hubSidebarEntry(noOrganization)).toBe("choose");
    expect(hubSidebarEntry(member)).toBeNull();
  });
});

describe("hubCardStage", () => {
  const card = (status: Status | null, dismissed: ReadonlyArray<string> = []) =>
    hubCardStage({ status, environmentId: "env-1", dismissed });

  it("shows the sign-in until it is dismissed on this environment", () => {
    expect(card(signedOut)).toBe("sign-in");
    expect(card(signedOut, ["env-1"])).toBeNull();
    expect(card(signedOut, ["env-2"])).toBe("sign-in");
  });

  it("offers the organization choice after signing in, even where the sign-in was dismissed", () => {
    expect(card(noOrganization, ["env-1"])).toBe("choose");
    expect(card(member)).toBeNull();
  });

  it("shows nothing before this computer's Peer answers", () => {
    expect(card(null)).toBeNull();
    expect(hubCardStage({ status: signedOut, environmentId: null, dismissed: [] })).toBeNull();
  });
});

describe("dismissHubCard", () => {
  it("remembers each environment once", () => {
    expect(dismissHubCard([], "env-1")).toEqual(["env-1"]);
    expect(dismissHubCard(["env-1"], "env-1")).toEqual(["env-1"]);
    expect(dismissHubCard(["env-1"], "env-2")).toEqual(["env-1", "env-2"]);
  });
});
