import { describe, expect, it } from "vite-plus/test";
import { makeRequestObserver, batchNotice, stillPending, noticeEnabled } from "./notify.logic";
const row = {
  id: "one",
  project: "app",
  task: "task",
  sender: "ana@acme.test",
  recipient: "bob@acme.test",
  title: "Download pipelines",
  prompt: "Private text",
  status: "pending" as const,
  createdAt: "now",
  updatedAt: "now",
};
const status = (ids: ReadonlyArray<string>) => ({
  signedIn: true,
  email: row.recipient,
  requests: ids.map((id) => ({ workspace: "team", request: { ...row, id } })),
});
describe("request arrival notices", () => {
  it("seeds quietly, batches new requests and shares discovery across environments", () => {
    const observer = makeRequestObserver();
    expect(observer.observe("one", status(["one", "two"]))).toEqual([]);
    expect(
      observer.observe("one", status(["one", "two", "three"])).map((row) => row.request.id),
    ).toEqual(["three"]);
    expect(observer.observe("two", status(["one", "two", "three"]))).toEqual([]);
    expect(observer.observe("one", status(["four", "five", "six"]))).toHaveLength(3);
    expect(observer.observe("two", status(["one", "four", "five", "six"]))).toEqual([]);
  });
  it("reseeds after loading, sign-out or disabling without replaying old requests", () => {
    const observer = makeRequestObserver();
    observer.observe("one", status(["one"]));
    for (const reset of [
      null,
      { signedIn: false, email: row.recipient },
      { signedIn: true, email: row.recipient },
      { ...status(["one"]), plugins: [{ id: "requests", active: false }] },
    ]) {
      expect(observer.observe("one", reset)).toEqual([]);
      expect(observer.observe("one", status(["one", "two"]))).toEqual([]);
    }
  });
  it("does not leak text in titles and closes alerts for all answered outcomes", () => {
    const batch = status(["one"]).requests;
    expect(batchNotice(batch)).toEqual({
      title: "Team request",
      body: "ana@acme.test: Download pipelines",
    });
    expect(batchNotice(status(["one", "two", "three"]).requests)).toEqual({
      title: "3 team requests",
      body: "Open Needs you to review the requests waiting on you.",
    });
    for (const [statusValue, closedBy] of [
      ["accepted", undefined],
      ["dismissed", "sender"],
      ["dismissed", "expiry"],
    ] as const)
      expect(
        stillPending(batch, [
          {
            ...status([]),
            requests: [
              {
                workspace: "team",
                request: {
                  ...row,
                  status: statusValue,
                  ...(closedBy === undefined ? {} : { closedBy }),
                },
              },
            ],
          },
        ]),
      ).toEqual([]);
    expect(noticeEnabled("off", false)).toBe(false);
    expect(noticeEnabled("off", true)).toBe(true);
  });
});
