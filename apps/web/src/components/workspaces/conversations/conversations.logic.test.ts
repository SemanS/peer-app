import { describe, expect, it } from "vite-plus/test";

import { plainSummary } from "./conversations.logic";

describe("plainSummary", () => {
  it("reads Markdown as plain prose, cut at a sentence or a word", () => {
    expect(
      plainSummary(
        "## Overview `strata-server` (binary `strata`) is the crate root. It serves **HTTP** APIs.",
      ),
    ).toBe("strata-server (binary strata) is the crate root. It serves HTTP APIs.");
    expect(
      plainSummary("## Overview\n\n- Uses [TiKV](https://tikv.org) for _state_.\n- Runs `jobs`."),
    ).toBe("Uses TiKV for state. Runs jobs.");
    const long = plainSummary(`${"First part is the gist".padEnd(150, " a")}. ${"b ".repeat(80)}`);
    expect(long.endsWith(".")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(220);
    expect(plainSummary("word ".repeat(80), 40).endsWith("…")).toBe(true);
  });
});
