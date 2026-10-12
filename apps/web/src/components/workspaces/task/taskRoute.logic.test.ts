import { describe, expect, it } from "vite-plus/test";

import { taskIdOfParams } from "./taskRoute.logic";

describe("taskIdOfParams", () => {
  it("reads the task from the review page's param and the task context page's scope", () => {
    expect(taskIdOfParams({ task: "ord-7" })).toBe("ord-7");
    expect(taskIdOfParams({ scope: "task:ord-7" })).toBe("ord-7");
  });

  it("names no task for the project's own context or for a page about something else", () => {
    expect(taskIdOfParams({ scope: "project" })).toBeUndefined();
    expect(taskIdOfParams({ scope: "task:" })).toBeUndefined();
    expect(taskIdOfParams({})).toBeUndefined();
    expect(taskIdOfParams({ task: "" })).toBeUndefined();
  });

  it("prefers the param when a route has both", () => {
    expect(taskIdOfParams({ task: "a", scope: "task:b" })).toBe("a");
  });
});
