import { assert, describe, it } from "@effect/vitest";

import { boundHerdrClient, type HerdrClientShape } from "./HerdrClient.ts";

/** A client that says which socket each call reached. */
function recordingClient() {
  const reached: Array<string> = [];
  const followed: Array<string | (() => string) | undefined> = [];
  const note = (call: string, socket: string | undefined) =>
    void reached.push(`${call} ${socket ?? "default"}`);
  const client: HerdrClientShape = {
    follow: (_onChange, _retryMs, socket) => {
      followed.push(socket);
      return { read: async () => null, live: () => false, close: () => undefined };
    },
    list: async (socket) => (note("list", socket), null),
    read: async (_pane, socket) => (note("read", socket), { kind: "unavailable" }),
    screen: async (_paneId, socket) => (note("screen", socket), null),
    keys: async (_target, _keys, socket) => note("keys", socket),
    prompt: async (_target, _text, socket) => note("prompt", socket),
    wake: async (_agent, _text, socket) => (note("wake", socket), { status: "queued" }),
    focus: async (_pane, socket) => note("focus", socket),
    notify: async (_title, _body, socket) => note("notify", socket),
    start: async (_input, socket) => (note("start", socket), { paneId: "w1:p1", terminalId: "t1" }),
  };
  return { client, reached, followed };
}

describe("a client bound to the herdr in use", () => {
  it("sends every call to the socket named when the call is made", async () => {
    const { client, reached } = recordingClient();
    let socket = "/peer/herdr.sock";
    const bound = boundHerdrClient(client, () => socket);
    await bound.list();
    socket = "/own/herdr.sock";
    await bound.read("w1:p1");
    await bound.prompt("w1:p1", "go");
    await bound.wake(
      {
        terminalId: "t1",
        paneId: "w1:p1",
        agent: "claude",
        title: "agent",
        status: "idle",
        completionSeq: undefined,
        cwd: undefined,
        session: undefined,
      },
      "news",
    );
    await bound.focus("w1:p1");
    await bound.notify("title", "body");
    await bound.start({ cwd: "/work", harness: "claude" });
    assert.deepStrictEqual(reached, [
      "list /peer/herdr.sock",
      "read /own/herdr.sock",
      "prompt /own/herdr.sock",
      "wake /own/herdr.sock",
      "focus /own/herdr.sock",
      "notify /own/herdr.sock",
      "start /own/herdr.sock",
    ]);
  });

  it("keeps a socket a call names, and gives the follower the function so it moves", () => {
    const { client, reached, followed } = recordingClient();
    let socket = "/peer/herdr.sock";
    const bound = boundHerdrClient(client, () => socket);
    void bound.focus("w1:p1", "/named/herdr.sock");
    bound.follow(() => undefined, 1000);
    assert.deepStrictEqual(reached, ["focus /named/herdr.sock"]);
    const asked = followed[0];
    assert.isFunction(asked);
    socket = "/own/herdr.sock";
    assert.strictEqual(typeof asked === "function" ? asked() : asked, "/own/herdr.sock");
  });
});
