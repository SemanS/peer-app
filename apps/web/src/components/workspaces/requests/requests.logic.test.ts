import { describe, expect, it } from "vite-plus/test";
import { expiryLabel, requestRow, sentOutcome } from "./requests.logic";
const row = {
  id: "one",
  project: "app",
  task: "task",
  sender: "ana@test.sk",
  recipient: "bob@test.sk",
  title: "Pull",
  prompt: "Flows",
  status: "pending" as const,
  createdAt: "now",
  updatedAt: "now",
};
describe("request row wording", () => {
  it("only offers supported withdrawal and words expiry without a timer", () => {
    const now = Date.parse("2026-10-09T00:00:00Z");
    expect(expiryLabel(row, now)).toBeUndefined();
    for (const [days, text] of [
      [0, "Expires today"],
      [1, "Expires tomorrow"],
      [13, "Expires in 13 days"],
    ] as const)
      expect(
        expiryLabel({ ...row, expiresAt: new Date(now + days * 86400000).toISOString() }, now),
      ).toBe(text);
    expect(requestRow({ ...row, expiresAt: "2026-10-23" }, row.sender, now).withdraw).toBe(true);
    expect(
      requestRow({ ...row, status: "dismissed", closedBy: "sender" }, row.sender, now),
    ).toMatchObject({ outcome: "withdrawn", withdraw: false });
  });
});

describe("what the sender reads", () => {
  it("names each outcome, and a recipient's dismissal is a decline", () => {
    expect(sentOutcome(row)).toEqual({ label: "Waiting", badge: "team" });
    expect(sentOutcome({ ...row, status: "accepted" }).label).toBe("Accepted");
    expect(
      sentOutcome({ ...row, status: "dismissed", closedBy: "recipient", reason: "Monday?" }),
    ).toEqual({ label: "Declined", badge: "secondary" });
    expect(sentOutcome({ ...row, status: "dismissed", closedBy: "sender" }).label).toBe(
      "Withdrawn",
    );
    expect(sentOutcome({ ...row, status: "dismissed", closedBy: "expiry" }).label).toBe("Expired");
  });
});
