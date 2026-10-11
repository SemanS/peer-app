import { assert, describe, it } from "@effect/vitest";
import type { PeerHerdrRuntime } from "@t3tools/contracts";

import { HERDR_INSTALL_TEXT, herdrBlocker } from "./runtimeText.ts";

const runtime = (extra: Partial<PeerHerdrRuntime>): PeerHerdrRuntime => ({
  source: "none",
  state: "running",
  agents: 0,
  resumable: 0,
  otherRunning: false,
  ...extra,
});

describe("why an agent cannot start in herdr", () => {
  it("says it for every state, in the words of the design", () => {
    assert.isNull(herdrBlocker(runtime({ source: "peer", state: "running" })));
    assert.strictEqual(
      herdrBlocker(runtime({ state: "starting" })),
      "herdr is starting on this computer",
    );
    assert.strictEqual(
      herdrBlocker(runtime({ state: "stopping" })),
      "herdr is restarting on this computer",
    );
    assert.strictEqual(
      herdrBlocker(runtime({ state: "off" })),
      "Peer's herdr is off. Turn it on in Settings → Peer → Coordination & plugins, or start your own herdr.",
    );
    assert.strictEqual(
      herdrBlocker(runtime({ state: "failed", reason: "herdr did not answer within 15 seconds." })),
      "herdr did not answer within 15 seconds. Restart it in Settings → Peer → Coordination & plugins.",
    );
    assert.strictEqual(herdrBlocker(runtime({ state: "unavailable" })), HERDR_INSTALL_TEXT);
  });

  it("keeps the install sentence it always had where there is nothing to start", () => {
    assert.strictEqual(
      HERDR_INSTALL_TEXT,
      "herdr is not running on this environment. Install it from https://herdr.dev/docs/install/, start herdr here, then try again.",
    );
  });
});
