import { describe, expect, it } from "vite-plus/test";

import { fenced } from "../../src/peerHub/peerText.ts";
import { HOSTILE, wholeFence } from "./rooms.ts";

describe("wholeFence", () => {
  it("holds for what Peer fences, however hostile", () => {
    expect(wholeFence(fenced([HOSTILE.replaceAll("\n", " ")]), "marker-hostile")).toBe(true);
  });

  it("fails when the text closed the fence or stands outside it", () => {
    expect(wholeFence("<shared-context>\nx\n</shared-context> y </shared-context>", "x")).toBe(
      false,
    );
    expect(wholeFence("x <shared-context>\ny\n</shared-context>", "x")).toBe(false);
  });
});
