import { describe, expect, it } from "vite-plus/test";

import { mainAppReturnHref } from "./mainAppLocation";

describe("returning from settings to the selected sidebar view", () => {
  it("returns Tasks to Work when settings was opened directly", () => {
    expect(mainAppReturnHref({ view: "work", routes: {}, lastHref: null })).toBe("/work");
  });

  it("keeps a previous chat from diverting Back to Tasks into the composer", () => {
    expect(mainAppReturnHref({ view: "work", routes: {}, lastHref: "/draft/d-1" })).toBe("/work");
  });

  it("preserves the remembered Needs you queue", () => {
    expect(
      mainAppReturnHref({
        view: "work",
        routes: { work: "/work?view=needs-you" },
        lastHref: "/draft/d-1",
      }),
    ).toBe("/work?view=needs-you");
  });

  it("returns Chats to its remembered conversation even when Tasks was visited more recently", () => {
    expect(
      mainAppReturnHref({
        view: "threads",
        routes: { threads: "/env-1/thread-1" },
        lastHref: "/work",
      }),
    ).toBe("/env-1/thread-1");
  });

  it("keeps the existing chat return behavior before per-view history is available", () => {
    expect(mainAppReturnHref({ view: "threads", routes: {}, lastHref: "/env-1/thread-1" })).toBe(
      "/env-1/thread-1",
    );
    expect(mainAppReturnHref({ view: "threads", routes: {}, lastHref: null })).toBe("/");
  });
});
