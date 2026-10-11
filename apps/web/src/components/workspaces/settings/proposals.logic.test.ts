import type { PeerSettingsProposal } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { PeerSettingsLocation } from "./peerSettings.logic";
import {
  bannerText,
  proposalPageOf,
  proposalsOnPage,
  proposedByText,
  proposerText,
  splitProposals,
} from "./proposals.logic";

const proposal = (id: string, extra: Partial<PeerSettingsProposal> = {}): PeerSettingsProposal => ({
  id,
  by: { email: "ana@acme.dev", name: "Ana" },
  via: { kind: "agent", agent: "codex" },
  at: "2026-10-11T10:00:00Z",
  base: 42,
  message: "Migrations must not run twice",
  instruction: "make migrations exclusive in Booking",
  lines: [],
  scopes: ["project:booking"],
  owners: "Booking's leads and admins",
  state: "pending",
  mine: false,
  canDecide: true,
  ...extra,
});

describe("which proposals a page shows", () => {
  const project: PeerSettingsLocation = {
    kind: "project",
    workspace: "acme",
    projectId: "booking",
    tab: "tools",
  };
  const section = (name: string): PeerSettingsLocation => ({
    kind: "workspace",
    workspace: "acme",
    section: name as never,
  });

  it("gives a project's pages the project, a workspace's pages the workspace, AI subscriptions the person", () => {
    expect(proposalPageOf(project, "ana@acme.dev")).toEqual({
      workspace: "acme",
      scope: "project:booking",
    });
    expect(proposalPageOf(section("tools"), "ana@acme.dev")).toEqual({
      workspace: "acme",
      scope: "workspace",
    });
    expect(proposalPageOf(section("plans"), "ana@acme.dev")).toEqual({
      workspace: "acme",
      scope: "person:ana@acme.dev",
    });
  });

  it("gives Keys, Slack, the computer's pages and an unknown page none", () => {
    expect(proposalPageOf(section("keys"), "ana@acme.dev")).toBeNull();
    expect(proposalPageOf(section("slack"), "ana@acme.dev")).toBeNull();
    expect(proposalPageOf(section("plans"), null)).toBeNull();
    expect(
      proposalPageOf({ kind: "computer", section: "coordination" }, "ana@acme.dev"),
    ).toBeNull();
    expect(proposalPageOf(null, "ana@acme.dev")).toBeNull();
  });

  it("filters to pending proposals that touch the page's scope, newest first", () => {
    const older = proposal("older", { at: "2026-10-10T10:00:00Z" });
    const newer = proposal("newer");
    const elsewhere = proposal("elsewhere", { scopes: ["project:camp-bot"] });
    const decided = proposal("decided", { state: "applied" });
    const person = proposal("person", { scopes: ["person:Ana@acme.dev"] });
    expect(
      proposalsOnPage([older, elsewhere, decided, newer], "project:booking").map((p) => p.id),
    ).toEqual(["newer", "older"]);
    expect(proposalsOnPage([person, newer], "person:ana@acme.dev").map((p) => p.id)).toEqual([
      "person",
    ]);
  });

  it("puts an ask that touches nothing on the workspace's pages", () => {
    const ask = proposal("ask", { scopes: [], lines: [] });
    expect(proposalsOnPage([ask], "workspace").map((p) => p.id)).toEqual(["ask"]);
    expect(proposalsOnPage([ask], "project:booking")).toEqual([]);
  });
});

describe("who has to act", () => {
  it("splits the proposals the person decides from their own that wait on others", () => {
    const decide = proposal("decide");
    const ownAndOwner = proposal("own-owner", { mine: true, canDecide: true });
    const waiting = proposal("waiting", { mine: true, canDecide: false });
    const strangers = proposal("strangers", { mine: false, canDecide: false });
    expect(splitProposals([decide, ownAndOwner, waiting, strangers])).toEqual({
      deciding: [decide, ownAndOwner],
      waiting: [waiting],
    });
  });
});

describe("the banner's words", () => {
  const waiting = (owners: string) => proposal("w", { mine: true, canDecide: false, owners });

  it("counts what waits for the person", () => {
    expect(bannerText([proposal("a")], [])).toBe("1 proposal waits for you");
    expect(bannerText([proposal("a"), proposal("b")], [])).toBe("2 proposals wait for you");
  });

  it("names who the person's own proposals wait for, when it is one answer", () => {
    expect(bannerText([], [waiting("admins")])).toBe("Your proposal waits for admins");
    expect(bannerText([], [waiting("admins"), waiting("admins")])).toBe(
      "Your 2 proposals wait for admins",
    );
    expect(bannerText([], [waiting("admins"), waiting("Booking's leads and admins")])).toBe(
      "Your 2 proposals wait for their owners",
    );
  });

  it("says both, or nothing", () => {
    expect(bannerText([proposal("a")], [waiting("admins")])).toBe(
      "1 proposal waits for you · Your proposal waits for admins",
    );
    expect(bannerText([], [])).toBeNull();
  });
});

describe("who proposed it", () => {
  it("names the agent for the person who asked, or the person alone", () => {
    expect(proposerText({ via: { kind: "agent", agent: "codex" } }, "Ana")).toBe("Codex for Ana");
    expect(proposerText({ via: { kind: "agent", agent: "claude" } }, "Ana")).toBe(
      "Claude Code for Ana",
    );
    expect(proposerText({ via: null }, "Ana")).toBe("Ana");
    expect(proposerText({}, "Ana")).toBe("Ana");
  });

  it("heads a review with who proposed it and why", () => {
    expect(
      proposedByText(
        { via: { kind: "agent", agent: "codex" }, message: " Migrations must not run twice " },
        "Ana",
      ),
    ).toBe("Proposed by Codex for Ana: Migrations must not run twice");
    expect(proposedByText({ via: null, message: "" }, "Ana")).toBe("Proposed by Ana");
  });
});
