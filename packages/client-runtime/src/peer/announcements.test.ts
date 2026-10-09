import { describe, expect, it } from "@effect/vitest";
import {
  announcementCharacterCount,
  editAnnouncementDraft,
  newAnnouncementDraft,
  announcementReach,
  receiptLabel,
  canPollAnnouncement,
  recentAnnouncements,
  announcementDraftError,
  mayManageAnnouncementCredentials,
  mayWithdrawAnnouncement,
  announcementReachLine,
  announcementTiming,
} from "./announcements.ts";
describe("announcement client decisions", () => {
  it("counts Unicode code points and retains a retry op until a meaningful edit", () => {
    expect(announcementCharacterCount("😎".repeat(300))).toBe(300);
    const draft = editAnnouncementDraft(
      newAnnouncementDraft("first"),
      { text: "CI is red" },
      "posted",
    );
    expect(editAnnouncementDraft(draft, { text: "CI is red" }, "unused").op).toBe("posted");
    expect(editAnnouncementDraft(draft, { wake: false }, "edited").op).toBe("edited");
    expect(announcementDraftError({ ...draft, text: "😎".repeat(301) })).toContain("300");
    expect(announcementDraftError({ ...draft, text: "   " })).toContain("message");
  });
  it("counts eligible live sessions without claiming receipt and separates nonfollowing agents", () => {
    const sessions = [
      { project: "app", task: "t", status: "working", agent: "claude" },
      { project: "app", task: "other", status: "idle", agent: "codex" },
      { project: "app", task: "t", status: "idle", agent: "unknown" },
      { project: "app", task: "t", status: "done", agent: "claude" },
    ];
    expect(announcementReach(sessions, "app", "t")).toEqual({
      following: 1,
      notFollowing: 1,
      total: 1,
      idle: 0,
    });
    expect(announcementReach(sessions, "app")).toEqual({
      following: 2,
      notFollowing: 1,
      total: 2,
      idle: 1,
    });
    expect(mayManageAnnouncementCredentials("member", "admin")).toBe(true);
    expect(mayManageAnnouncementCredentials("member", "member")).toBe(false);
    expect(mayWithdrawAnnouncement({ kind: "person", email: "me" }, "me", "member", "member")).toBe(
      true,
    );
    expect(
      mayWithdrawAnnouncement(
        { kind: "credential", id: "ci", label: "CI" },
        "me",
        "member",
        "member",
      ),
    ).toBe(false);
    expect(announcementReach(sessions, "missing")).toEqual({
      following: 0,
      notFollowing: 0,
      total: 0,
      idle: 0,
    });
    expect(announcementReach(sessions.slice(0, 1), "app")).toEqual({
      following: 1,
      notFollowing: 0,
      total: 1,
      idle: 0,
    });
    expect(receiptLabel("offered")).toBe("Offered to adapter");
    expect(receiptLabel("model-input")).toBe("Verified in model input");
    expect(canPollAnnouncement(false, "active")).toBe(false);
    expect(canPollAnnouncement(true, "withdrawn")).toBe(false);
    expect(announcementReachLine(announcementReach(sessions, "app", "t"))).toContain(
      "Only Claude Code and Codex with Peer’s hooks are reached",
    );
  });
  it("uses the Hub clock to show age and remaining validity without promising delivery", () => {
    const row = { createdAt: "2026-10-09T08:00:00Z", expiresAt: "2026-10-10T08:00:00Z" };
    expect(announcementTiming(row, "2026-10-09T10:00:00Z")).toBe("2h ago · 22h left");
    expect(announcementTiming(row, "2026-10-10T10:00:00Z")).toBe("1d ago · expired");
    expect(announcementTiming(row, "2026-10-09T08:00:00Z")).toBe("just now · 1d left");
  });
  it("orders recent history and keeps at most ten entries", () => {
    expect(
      recentAnnouncements(
        Array.from({ length: 12 }, (_, i) => ({
          id: String(i),
          createdAt: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        })),
      ).map((r) => r.id),
    ).toEqual(["11", "10", "9", "8", "7", "6", "5", "4", "3", "2"]);
  });
});
