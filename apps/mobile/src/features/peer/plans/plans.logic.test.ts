import type { PeerHubStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { plansRowValue } from "./plans.logic";

describe("Plans' row in the Settings index", () => {
  const listed = (over: object): Pick<PeerHubStatus, "plugins" | "signedIn"> => ({
    signedIn: true,
    plugins: [{ id: "plans", title: "Plans", enabled: true, active: true, ...over }],
  });

  it("says on, off, forced off, waiting for a Hub or needing a newer one, as the plugin list does", () => {
    expect(plansRowValue(listed({}))).toBe("On");
    expect(plansRowValue(listed({ enabled: false, active: false, reason: "off" }))).toBe("Off");
    expect(
      plansRowValue(
        listed({ enabled: false, active: false, reason: "PEER_PLANS=off", locked: true }),
      ),
    ).toBe("Forced off");
    expect(plansRowValue(listed({ active: false, reason: "hub" }))).toBe("Needs a newer Hub");
    expect(plansRowValue(listed({ active: false, reason: "hub-unknown" }))).toBe("Waits for a Hub");
    expect(plansRowValue({ ...listed({ active: false, reason: "hub" }), signedIn: false })).toBe(
      "Waits for a Hub",
    );
  });

  it("has no row on a computer that does not list Plans, or before its status arrived", () => {
    expect(plansRowValue({ signedIn: true, plugins: [] })).toBeNull();
    expect(plansRowValue(null)).toBeNull();
    expect(plansRowValue(undefined)).toBeNull();
  });
});
