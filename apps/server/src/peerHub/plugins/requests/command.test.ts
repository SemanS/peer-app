import {
  PeerHubError,
  type PeerAgentRequest,
  type PeerHubSendRequestInput,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { brokerFixture } from "../../core/broker/testkit.ts";
import { NO_PLUGINS } from "../../core/broker/host.ts";
import { requestCommand } from "./command.ts";
const row: PeerAgentRequest = {
  id: "one",
  project: "app",
  task: "task",
  sender: "ana@acme.test",
  recipient: "bob@acme.test",
  title: "Download pipelines",
  prompt: "Private long sender text",
  status: "pending",
  createdAt: "2026-10-09",
  updatedAt: "2026-10-09",
  expiresAt: "2026-10-23",
};
const exercise = async (
  check: (
    run: (args: ReadonlyArray<string>) => Promise<string>,
    calls: PeerHubSendRequestInput[],
  ) => Promise<void>,
  options: {
    row?: PeerAgentRequest;
    error?: PeerHubError;
    rows?: ReadonlyArray<PeerAgentRequest>;
  } = {},
) => {
  const calls: PeerHubSendRequestInput[] = [];
  const command = requestCommand({
    send: (input) => {
      calls.push(input);
      return options.error ? Effect.fail(options.error) : Effect.succeed(options.row ?? row);
    },
    list: () =>
      options.error ? Effect.fail(options.error) : Effect.succeed(options.rows ?? [row]),
    withdraw: () =>
      options.error
        ? Effect.fail(options.error)
        : Effect.succeed({ ...row, status: "dismissed", closedBy: "sender" }),
  });
  const fixture = await brokerFixture(() => ({
    plugins: async () => ({ ...NO_PLUGINS, commands: [{ plugin: "requests", command }] }),
  }));
  try {
    await fixture.register("request");
    const session = fixture.broker.sessions.get("claude:request")!;
    session.claims = ["pay.ts"];
    session.pending.push("unread teammate note");
    const before = JSON.stringify(fixture.broker.snapshot());
    await check(
      (args) => fixture.broker.runCli("request", args, { "x-peer-session": "claude:request" }),
      calls,
    );
    expect(JSON.stringify(fixture.broker.snapshot())).toBe(before);
    expect(session.claims).toEqual(["pay.ts"]);
    expect(session.pending).toEqual(["unread teammate note"]);
    expect(session.read.size).toBe(0);
    expect(session.memory.acknowledged.size).toBe(0);
  } finally {
    await fixture.dispose();
  }
};
describe("request outcomes", () => {
  it("reports a durable id, operation, expiry and withdrawal after a fresh send", () =>
    exercise(async (run, calls) => {
      const text = await run([row.recipient, "Full\nrequest", "--op", "retry-one"]);
      for (const part of [
        "one",
        "retry-one",
        row.recipient,
        row.title,
        "2026-10-23",
        "peer request withdraw one",
      ])
        expect(text).toContain(part);
      expect(calls[0]?.prompt).toBe("Full\nrequest");
    }));
  it.each(["sender", "expiry", undefined])("never claims a replay was sent (%s)", (closedBy) =>
    exercise(
      async (run) => {
        const text = await run([row.recipient, "Full request", "--op", "retry-one"]);
        expect(text).toContain("already used");
        expect(text).toContain(
          closedBy === "sender" ? "withdrawn" : closedBy === "expiry" ? "expired" : "dismissed",
        );
        expect(text).toContain("new --op");
        expect(text).not.toContain("Request sent");
      },
      { row: { ...row, status: "dismissed", closedBy, replayed: true } },
    ),
  );
  it("validates malformed operations, flags, oversized text and titles before Hub mutation", () =>
    exercise(async (run, calls) => {
      for (const args of [
        [],
        [row.recipient],
        [row.recipient, "Text", "--op", "Not_Valid"],
        [row.recipient, "Text", "--title", "x".repeat(121)],
        [row.recipient, "Text", "--unknown", "x"],
        [row.recipient, "Text", "--op"],
        [row.recipient, "x".repeat(20_001)],
        ["withdraw"],
        ["list", "--op", "x"],
      ])
        await expect(run(args)).rejects.toMatchObject({
          outcome: "usage",
          next: expect.stringMatching(/request|--op|--title/),
        });
      expect(calls).toEqual([]);
    }));
  it("lists only the caller's project without sender text and withdraws truthfully", () =>
    exercise(
      async (run) => {
        const text = await run(["list"]);
        expect(text).toContain("one");
        expect(text).toContain("accepted");
        expect(text.indexOf("one")).toBeLessThan(text.indexOf("closed"));
        expect(text).not.toContain(row.prompt);
        expect(text).not.toContain("other");
        const withdrawn = await run(["withdraw", "one"]);
        expect(withdrawn).toContain("left their Needs you");
        expect(withdrawn).toContain("task stays");
      },
      {
        rows: [
          { ...row, id: "closed", status: "accepted" },
          row,
          { ...row, id: "other", project: "else" },
        ],
      },
    ));
  it.each([true, false])("classifies Hub failures refused=%s", (refused) =>
    exercise(
      async (run) => {
        await expect(
          run([row.recipient, "Full request", "--op", "retry-one"]),
        ).rejects.toMatchObject({
          outcome: refused ? "refused" : "uncertain",
          next: expect.stringContaining(refused ? "Tell your person" : "--op retry-one"),
        });
        await expect(run(["list"])).rejects.toMatchObject({
          outcome: "refused",
          next: expect.stringContaining("retry"),
        });
      },
      {
        error: new PeerHubError({
          detail: refused
            ? "Recipient inbox is full. Wait for an answer."
            : "Could not reach the hub.",
          ...(refused ? { refused: true } : {}),
        }),
      },
    ),
  );
  it.each(["Sign in first.", "Your session with the hub ended. Sign in again."])(
    "gives a sign-in recovery for %s on every request command",
    (detail) =>
      exercise(
        async (run) => {
          for (const args of [
            [row.recipient, "Full request", "--op", "retry-one"],
            ["list"],
            ["withdraw", "one"],
          ])
            await expect(run(args)).rejects.toMatchObject({
              outcome: "refused",
              next: expect.stringContaining("sign in"),
            });
        },
        { error: new PeerHubError({ detail, refused: true }) },
      ),
  );
});
