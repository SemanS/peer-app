import { describe, expect, it } from "vite-plus/test";

import { workSearch } from "./workNavigation.logic";

describe("workSearch", () => {
  it("keeps a project scope and forgets what the Feed no longer reads", () => {
    expect(workSearch({ scope: "team/orders", view: "needs-you" })).toEqual({
      scope: "team/orders",
    });
    expect(workSearch({ scope: "" })).toEqual({});
    expect(workSearch({})).toEqual({});
  });
});
