import { describe, expect, it } from "vite-plus/test";

import { SIDEBAR_VIEW_LABELS, sidebarScopeLine } from "./SidebarViewSwitch.logic";

describe("sidebarScopeLine", () => {
  it("names the project in both views", () => {
    expect(sidebarScopeLine("work", "webinson/receipt-printer", "Receipt printer")).toBe(
      "Team tasks in Receipt printer",
    );
    expect(sidebarScopeLine("threads", "webinson/receipt-printer", "Receipt printer")).toBe(
      "Your chats in Receipt printer",
    );
  });

  it("says all projects for the whole catalog", () => {
    expect(sidebarScopeLine("work", "all", undefined)).toBe("Team tasks in all projects");
    expect(sidebarScopeLine("threads", "all", undefined)).toBe("Your chats in all projects");
  });

  it("reads a scope with no name as every project, as the lists do", () => {
    expect(sidebarScopeLine("threads", "webinson/gone", undefined)).toBe(
      "Your chats in all projects",
    );
    expect(sidebarScopeLine("work", "all", "Ignored")).toBe("Team tasks in all projects");
  });
});

describe("the view labels", () => {
  it("call the stored views Tasks and Chats", () => {
    expect(SIDEBAR_VIEW_LABELS).toEqual({ work: "Tasks", threads: "Chats" });
  });
});
