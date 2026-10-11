import { assert, describe, it } from "@effect/vitest";

import { fakeHerdrProcess, fakeHerdrWorld } from "./HerdrProcess.testkit.ts";
import { makeHerdrRuntimeControl } from "./runtimeControl.ts";
import { HERDR_INSTALL_TEXT } from "./runtimeText.ts";

const STATE_DIR = "/home/ana/.peer";
const none = async () => null;

/** Lets the integrations read that follows Peer's herdr coming up finish. */
const settle = async () => {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
};

describe("the herdr runtime's status", () => {
  it("reads the integrations when Peer's herdr comes up, not when the status is read", async () => {
    const world = fakeHerdrWorld();
    let reads = 0;
    const port = fakeHerdrProcess(world);
    const control = makeHerdrRuntimeControl({
      port: { ...port, integrations: async (home) => (reads++, port.integrations(home)) },
      stateDir: STATE_DIR,
    });
    assert.deepStrictEqual(control.status().integrations, []);
    await control.tick();
    await settle();
    assert.strictEqual(reads, 1);
    control.status();
    control.status();
    assert.strictEqual(reads, 1);
    assert.deepStrictEqual(
      control.status().integrations.map((integration) => integration.state),
      ["missing", "missing"],
    );
    assert.deepStrictEqual(
      [control.status().bundled, control.status().runtime.source],
      [true, "peer"],
    );
  });

  it("reads them again after a change, and says why a change did not happen", async () => {
    const world = fakeHerdrWorld();
    const control = makeHerdrRuntimeControl({ port: fakeHerdrProcess(world), stateDir: STATE_DIR });
    await control.tick();
    assert.isUndefined(await control.setIntegration("codex", true));
    assert.strictEqual(control.status().integrations[1]?.state, "installed");

    const refusing = makeHerdrRuntimeControl({
      port: {
        ...fakeHerdrProcess(world),
        setIntegration: async () => ({ ok: false, reason: "python3 was not found." }),
      },
      stateDir: STATE_DIR,
    });
    await refusing.tick();
    assert.strictEqual(await refusing.setIntegration("claude", true), "python3 was not found.");
  });

  it("has no integrations to change where there is no binary", async () => {
    const world = fakeHerdrWorld({ binary: { available: false, reason: "No herdr." } });
    const control = makeHerdrRuntimeControl({ port: fakeHerdrProcess(world), stateDir: STATE_DIR });
    await control.tick();
    assert.deepStrictEqual(control.status().integrations, []);
    assert.match((await control.setIntegration("claude", true)) ?? "", /no herdr of Peer's own/);
  });
});

describe("why an agent cannot start", () => {
  it("is null while a herdr serves, whichever it is", async () => {
    const peer = makeHerdrRuntimeControl({
      port: fakeHerdrProcess(fakeHerdrWorld()),
      stateDir: STATE_DIR,
    });
    assert.isNull(await peer.launchBlocker(none));
    const own = makeHerdrRuntimeControl({
      port: fakeHerdrProcess(fakeHerdrWorld({ own: { version: "0.9.4", agents: [] } })),
      stateDir: STATE_DIR,
    });
    assert.isNull(await own.launchBlocker(none));
  });

  it("looks first, so that starting never only means not looked at yet", async () => {
    const control = makeHerdrRuntimeControl({
      port: fakeHerdrProcess(fakeHerdrWorld()),
      stateDir: STATE_DIR,
    });
    assert.strictEqual(control.supervisor.snapshot().state, "starting");
    assert.isNull(await control.launchBlocker(none));
    assert.strictEqual(control.supervisor.snapshot().state, "running");
  });

  it("names Off, and a failure with the way out", async () => {
    const off = makeHerdrRuntimeControl({
      port: fakeHerdrProcess(fakeHerdrWorld()),
      stateDir: STATE_DIR,
      bundled: false,
    });
    assert.strictEqual(
      await off.launchBlocker(none),
      "Peer's herdr is off. Turn it on in Settings → Peer → Coordination & plugins, or start your own herdr.",
    );
    const world = fakeHerdrWorld({ startFails: true });
    let now = 1_000_000;
    const failing = makeHerdrRuntimeControl({
      port: fakeHerdrProcess(world),
      stateDir: STATE_DIR,
      now: () => now,
    });
    await failing.tick();
    assert.strictEqual(await failing.launchBlocker(none), "herdr is starting on this computer");
    for (const wait of [1_000, 5_000]) {
      now += wait;
      await failing.tick();
    }
    assert.strictEqual(
      await failing.launchBlocker(none),
      "herdr exited. Restart it in Settings → Peer → Coordination & plugins.",
    );
  });

  it("asks the herdr that answers where Peer has none of its own", async () => {
    const control = makeHerdrRuntimeControl({
      port: fakeHerdrProcess(fakeHerdrWorld({ binary: { available: false, reason: "No herdr." } })),
      stateDir: STATE_DIR,
    });
    const asked: Array<string> = [];
    assert.strictEqual(
      await control.launchBlocker(async (socket) => (asked.push(socket), null)),
      HERDR_INSTALL_TEXT,
    );
    assert.isNull(await control.launchBlocker(async () => []));
    assert.deepStrictEqual(asked, ["/home/ana/.config/herdr/herdr.sock"]);
  });
});
