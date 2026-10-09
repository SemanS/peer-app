import type { PeerAgentRequest } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { listText, refusedNext, sentText, uncertainNext, withdrawnText } from "./text.ts";
const row: PeerAgentRequest = {
  id: "request-one",
  project: "app",
  task: "task",
  sender: "ana@acme.test",
  recipient: "bob@acme.test",
  title: "Download pipelines",
  prompt: "Private teammate text",
  status: "pending",
  createdAt: "2026-10-09",
  updatedAt: "2026-10-09",
  expiresAt: "2026-10-23",
};
describe("request sentences", () => {
  it("distinguishes sending once from every replay and keeps private text out of lists", () => {
    const fresh = sentText(row, "retry-one");
    for (const fact of [
      row.id,
      row.recipient,
      row.title,
      row.expiresAt!,
      "retry-one",
      "peer request withdraw request-one",
    ])
      expect(fresh).toContain(fact);
    for (const [status, closedBy, outcome] of [
      ["pending", undefined, "pending"],
      ["accepted", undefined, "accepted"],
      ["dismissed", "recipient", "dismissed"],
      ["dismissed", "sender", "withdrawn"],
      ["dismissed", "expiry", "expired"],
    ] as const) {
      const replay = sentText({ ...row, status, closedBy, replayed: true }, "retry-one");
      expect(replay).toContain(`is ${outcome}.`);
      expect(replay).toContain("already used");
      expect(replay).not.toContain("Request sent");
    }
    expect(listText("app", [row])).not.toContain(row.prompt);
    expect(withdrawnText(row)).toContain("task stays on the board");
    expect(uncertainNext("retry-one")).toContain("--op retry-one");
    expect(refusedNext).toContain("Tell your person");
    expect(refusedNext).not.toContain("HTTP 500");
  });
});
