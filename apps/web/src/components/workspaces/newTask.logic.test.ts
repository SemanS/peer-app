import type { PeerHubStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  areaChoices,
  canCreate,
  createdTaskId,
  createTaskInput,
  issueKey,
  issueKeyProblem,
  oneLine,
  TASK_TITLE_MAX,
  titleCount,
} from "./newTask.logic";

const scope = { workspace: "webinson", projectId: "ordering" };

describe("issue keys", () => {
  it("are stored in capitals, as the Hub stores them", () => {
    expect(issueKey("  krk-812 ")).toBe("KRK-812");
  });

  it("are optional", () => {
    expect(issueKeyProblem("")).toBeNull();
    expect(issueKeyProblem("   ")).toBeNull();
  });

  it("take the Hub's form: letters and digits in parts joined by dashes", () => {
    expect(issueKeyProblem("krk-812")).toBeNull();
    expect(issueKeyProblem("PAY-12-B")).toBeNull();
    expect(issueKeyProblem("KRK 812")).toBe(
      "A key is letters and digits joined by dashes, such as KRK-812.",
    );
    expect(issueKeyProblem("KRK--812")).not.toBeNull();
    expect(issueKeyProblem("-KRK")).not.toBeNull();
    expect(issueKeyProblem("Ž-1")).not.toBeNull();
  });

  it("have 2 to 32 characters", () => {
    expect(issueKeyProblem("K")).toBe("A key has 2 to 32 characters, such as KRK-812.");
    expect(issueKeyProblem("K".repeat(32))).toBeNull();
    expect(issueKeyProblem("K".repeat(33))).not.toBeNull();
  });
});

describe("titles", () => {
  it("stay on one line", () => {
    expect(oneLine("Refunds\nin cents")).toBe("Refunds in cents");
    expect(oneLine("Refunds \r\n  in cents")).toBe("Refunds in cents");
  });

  it("count characters only near the limit", () => {
    expect(titleCount("Split payments")).toBeNull();
    expect(titleCount("x".repeat(TASK_TITLE_MAX - 20))).toBeNull();
    expect(titleCount("x".repeat(TASK_TITLE_MAX - 19))).toBe(
      `${TASK_TITLE_MAX - 19} / ${TASK_TITLE_MAX}`,
    );
  });
});

describe("the area picker", () => {
  const areas = ["Payments", "Orders", "Menu"];

  it("lists every area before anything is typed", () => {
    expect(areaChoices(areas, "")).toEqual({ matches: areas, create: null });
  });

  it("filters by what was typed, in any case", () => {
    expect(areaChoices(areas, "pay")).toEqual({ matches: ["Payments"], create: "pay" });
  });

  it("offers a new area only when no area has that name", () => {
    expect(areaChoices(areas, "payments ").create).toBeNull();
    expect(areaChoices(areas, "Refunds")).toEqual({ matches: [], create: "Refunds" });
  });
});

describe("creating", () => {
  it("needs a title and a key the Hub takes", () => {
    expect(canCreate({ title: "  ", area: null, key: "" })).toBe(false);
    expect(canCreate({ title: "Split payments", area: null, key: "" })).toBe(true);
    expect(canCreate({ title: "Split payments", area: null, key: "KRK 812" })).toBe(false);
  });

  it("asks the Hub with the empty parts left out", () => {
    expect(createTaskInput(scope, { title: " Split payments ", area: null, key: "" })).toEqual({
      ...scope,
      title: "Split payments",
    });
    expect(createTaskInput(scope, { title: "Split payments", area: " ", key: " " })).toEqual({
      ...scope,
      title: "Split payments",
    });
  });

  it("sends the area as written and the key in capitals", () => {
    expect(
      createTaskInput(scope, { title: "Split\npayments", area: "Payments", key: "krk-812" }),
    ).toEqual({ ...scope, title: "Split payments", area: "Payments", key: "KRK-812" });
  });
});

describe("the created task", () => {
  const status = (tasks: ReadonlyArray<{ id: string; title: string }>) =>
    ({
      workspaces: [
        {
          slug: "webinson",
          projects: [{ project: { id: "ordering" }, work: { tasks } }],
        },
      ],
    }) as unknown as PeerHubStatus;

  it("is the project's task that was not there before", () => {
    const answer = status([
      { id: "ord-1", title: "Menu" },
      { id: "split-payments", title: "Split payments" },
    ]);
    expect(createdTaskId(answer, scope, new Set(["ord-1"]), "Split payments")).toBe(
      "split-payments",
    );
  });

  it("is the one with the title asked for when a teammate added another meanwhile", () => {
    const answer = status([
      { id: "theirs", title: "Their task" },
      { id: "mine", title: "Split payments" },
    ]);
    expect(createdTaskId(answer, scope, new Set(), "Split payments")).toBe("mine");
  });

  it("is unknown when the answer holds no new task", () => {
    expect(
      createdTaskId(status([{ id: "ord-1", title: "Menu" }]), scope, new Set(["ord-1"]), "x"),
    ).toBeUndefined();
  });
});
