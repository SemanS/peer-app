import { describe, expect, it } from "vite-plus/test";

import {
  CONNECTION_STATE_LABEL,
  connectionDetail,
  connectionNeedsAttention,
} from "./connectionStatus.logic";

describe("connectionDetail", () => {
  it("names the setup step before any detail", () => {
    expect(
      connectionDetail({
        detail: "Webinson as @peer",
        step: { n: 3, of: 4, title: "verify the stored token" },
      }),
    ).toBe("Step 3 of 4: verify the stored token");
  });

  it("falls back to the detail and leaves out an empty one", () => {
    expect(connectionDetail({ detail: "Signed in as SemanS" })).toBe("Signed in as SemanS");
    expect(connectionDetail({ detail: "" })).toBeUndefined();
    expect(connectionDetail({})).toBeUndefined();
  });
});

describe("connectionNeedsAttention", () => {
  it("counts setup and problems, not what is off or unavailable", () => {
    expect(
      Object.keys(CONNECTION_STATE_LABEL).filter((state) =>
        connectionNeedsAttention(state as keyof typeof CONNECTION_STATE_LABEL),
      ),
    ).toEqual(["setup", "problem"]);
  });
});
