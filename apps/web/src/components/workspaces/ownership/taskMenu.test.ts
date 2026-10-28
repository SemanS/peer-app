import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  report: vi.fn(),
  open: vi.fn(),
  team: vi.fn(),
}));
vi.mock("@t3tools/client-runtime/state/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/client-runtime/state/runtime")>()),
  runAtomCommand: mocks.run,
}));
vi.mock("../../../rpc/atomRegistry", () => ({ appAtomRegistry: {} }));
vi.mock("../../../state/server", () => ({
  serverEnvironment: { peerOwnership: { setTaskOwner: "set-task-owner", take: "take" } },
}));
vi.mock("../workFeedback", () => ({ reportFailure: mocks.report }));
vi.mock("./ownerDialog", () => ({ openOwnerDialog: mocks.open }));
vi.mock("./teamNavigation", () => ({ requestTeamPage: mocks.team }));

import { taskMenu } from "./taskMenu";
import { BOB, CYRIL, ENV, EVA, hubTask, slotProps, type Looking } from "./ownership.testkit";

afterEach(() => {
  vi.clearAllMocks();
});

const items = (email: string, id: string, looking?: Looking) =>
  taskMenu(slotProps(email, id, looking)).map((entry) => entry.item.label);

describe("the owner items of a task's menu", () => {
  it("offers each person only what they may do, and every member the owner map", () => {
    expect(items(BOB, "vl9")).toEqual(["Hand over…", "Give back", "See the owner map"]);
    expect(items(EVA, "vl9")).toEqual(["Set owner…", "See the owner map"]);
    expect(items(CYRIL, "vl9")).toEqual(["See the owner map"]);
    expect(items(CYRIL, "vl9", { workspace: "admin" })).toEqual([
      "Set owner…",
      "See the owner map",
    ]);
  });

  it("offers nothing where ownership is not known for the project", () => {
    expect(items(EVA, "vl9", { ownership: null })).toEqual([]);
  });

  it("sets the owner items apart from the menu's own, whoever sees them first", () => {
    const entries = taskMenu(slotProps(BOB, "vl9"));
    expect(entries.map((entry) => entry.item.separatorBefore)).toEqual([
      true,
      undefined,
      undefined,
    ]);
    // A member with nothing to change still has the owner map, set apart the same way.
    expect(taskMenu(slotProps(CYRIL, "vl9")).map((entry) => entry.item.separatorBefore)).toEqual([
      true,
    ]);
  });

  it("opens the project's owner map on the Team page, for whoever picks it", () => {
    for (const email of [BOB, CYRIL, EVA]) {
      const entry = taskMenu(slotProps(email, "vl9")).find(
        (candidate) => candidate.item.label === "See the owner map",
      )!;
      entry.run("owner:see-map");
      expect(mocks.team).toHaveBeenLastCalledWith({
        workspace: "acme",
        project: "ordering",
        view: "owner-map",
      });
    }
    expect(mocks.team).toHaveBeenCalledTimes(3);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("opens the dialog of the task the menu is on", () => {
    const entries = taskMenu(
      slotProps(EVA, "vl9", {
        ownership: {
          tasks: {
            vl9: {
              project: "ordering",
              task: "vl9",
              owner: EVA,
              since: "2026-10-12T20:00:00Z",
              reason: "named",
            },
          },
        },
      }),
    );
    const target = { environmentId: ENV, workspace: "acme", project: "ordering", task: "vl9" };
    entries.find((entry) => entry.item.label === "Set owner…")?.run("owner:set");
    expect(mocks.open).toHaveBeenLastCalledWith({ kind: "set", ...target });
    entries.find((entry) => entry.item.label === "Hand over…")?.run("owner:hand-over");
    expect(mocks.open).toHaveBeenLastCalledWith({ kind: "hand-over", ...target });
    expect(mocks.run).not.toHaveBeenCalled();
  });
});

describe("Give back", () => {
  const giveBack = () =>
    taskMenu(slotProps(BOB, "vl9")).find((entry) => entry.item.label === "Give back")!;

  it("sends no owner for the task, once, and says why when it is refused", async () => {
    const refused = { _tag: "Failure" };
    let settle: (result: unknown) => void = () => undefined;
    mocks.run.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    const entry = giveBack();
    entry.run("owner:give-back");
    entry.run("owner:give-back");
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledWith(
      {},
      "set-task-owner",
      {
        environmentId: ENV,
        input: {
          workspace: "acme",
          project: "ordering",
          task: "vl9",
          owner: null,
          op: expect.any(String),
        },
      },
      { reportFailure: false },
    );
    settle(refused);
    await vi.waitFor(() =>
      expect(mocks.report).toHaveBeenCalledWith("Could not give the task back", refused),
    );
    // Once it settles, giving back works again.
    mocks.run.mockResolvedValue({ _tag: "Success" });
    entry.run("owner:give-back");
    expect(mocks.run).toHaveBeenCalledTimes(2);
  });
});

describe("Take it", () => {
  const take = (looking?: Looking) =>
    taskMenu(slotProps(CYRIL, "vl11", looking)).find((entry) => entry.item.label === "Take it");

  it("is offered on a task nobody owns, first and set apart, and not once it is owned or done", () => {
    expect(items(CYRIL, "vl11")).toEqual(["Take it", "See the owner map"]);
    expect(taskMenu(slotProps(CYRIL, "vl11"))[0]?.item.separatorBefore).toBe(true);
    expect(items(CYRIL, "vl9")).not.toContain("Take it");
    expect(items(CYRIL, "vl10")).not.toContain("Take it");
    const done = { tasks: [hubTask("vl11", { area: "Menu", status: "done" })] };
    expect(take(done)).toBeUndefined();
  });

  it("makes the person the owner, once, and names who owns it when the Hub refuses", async () => {
    const refused = { _tag: "Failure", cause: "Bob owns this task already." };
    let settle: (result: unknown) => void = () => undefined;
    mocks.run.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    const entry = take()!;
    entry.run("owner:take");
    entry.run("owner:take");
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledWith(
      {},
      "take",
      {
        environmentId: ENV,
        input: { workspace: "acme", project: "ordering", task: "vl11", op: expect.any(String) },
      },
      { reportFailure: false },
    );
    settle(refused);
    await vi.waitFor(() =>
      expect(mocks.report).toHaveBeenCalledWith("Could not take VL11", refused),
    );
    mocks.run.mockResolvedValue({ _tag: "Success" });
    entry.run("owner:take");
    expect(mocks.run).toHaveBeenCalledTimes(2);
  });
});
