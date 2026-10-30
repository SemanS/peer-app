import { describe, expect, it } from "vite-plus/test";

import { taskShortTitle } from "./taskTitle.ts";

describe("taskShortTitle", () => {
  it("drops the creating verb and the file a task names", () => {
    expect(
      taskShortTitle(
        "Create the shared concurrency contract `modules/survey/editor/types/concurrency.ts`",
      ),
    ).toBe("Shared concurrency contract");
    expect(
      taskShortTitle("Create the presence contract `app/api/v3/presence/schemas.ts`. It holds x"),
    ).toBe("Presence contract");
  });

  it("reads code as words", () => {
    expect(taskShortTitle("Add `SurveyConflictError` (carrying two dates) to `a/errors.ts`")).toBe(
      "Survey conflict error",
    );
  });

  it("drops an opening place and keeps a verb that says the work", () => {
    expect(
      taskShortTitle("In `lib/survey/service.ts` `updateSurveyInternal`, move the segment writes"),
    ).toBe("Move the segment writes");
    expect(taskShortTitle("Extend `updateSurveyDraftAction` (`a/actions.ts`):")).toBe(
      "Extend update survey draft action",
    );
  });

  it("keeps a short title as it is and stays within six words", () => {
    expect(taskShortTitle("Fix the login page")).toBe("Fix the login page");
    expect(taskShortTitle("Run the single user regression gate on every survey spec")).toBe(
      "Run the single user regression gate",
    );
  });

  it("leaves a title with nothing else to say", () => {
    expect(taskShortTitle("`a/b.ts`")).toBe("`a/b.ts`");
  });
});
