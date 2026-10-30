import { describe, expect, it } from "vite-plus/test";

import {
  SIDEBAR_VIEW_LABELS,
  sidebarScopeLine,
  sidebarSwitchChoice,
  sidebarSwitchValue,
} from "./SidebarViewSwitch.logic";

describe("sidebarScopeLine", () => {
  it("names the project in both views", () => {
    expect(sidebarScopeLine("work", "webinson/receipt-printer", "Receipt printer")).toBe(
      "Work in Receipt printer",
    );
    expect(sidebarScopeLine("threads", "webinson/receipt-printer", "Receipt printer")).toBe(
      "Your chats in Receipt printer",
    );
  });

  it("says all projects for the whole catalog", () => {
    expect(sidebarScopeLine("work", "all", undefined)).toBe("Work in all projects");
    expect(sidebarScopeLine("threads", "all", undefined)).toBe("Your chats in all projects");
  });

  it("reads a scope with no name as every project, as the lists do", () => {
    expect(sidebarScopeLine("threads", "webinson/gone", undefined)).toBe(
      "Your chats in all projects",
    );
    expect(sidebarScopeLine("work", "all", "Ignored")).toBe("Work in all projects");
  });
});

describe("the view labels", () => {
  it("call the stored views Work and Chats", () => {
    expect(SIDEBAR_VIEW_LABELS).toEqual({ work: "Work", threads: "Chats" });
  });
});

describe("the switch", () => {
  it("shows the tab while on the work, and Chats while on the chats", () => {
    expect(sidebarSwitchValue("work", "knowledge")).toBe("knowledge");
    expect(sidebarSwitchValue("threads", "knowledge")).toBe("chats");
  });

  it("reads a choice as a view and, for the work, a tab", () => {
    expect(sidebarSwitchChoice("activity")).toEqual({ view: "work", tab: "activity" });
    expect(sidebarSwitchChoice("chats")).toEqual({ view: "threads" });
    expect(sidebarSwitchChoice(undefined)).toBeUndefined();
  });
});
