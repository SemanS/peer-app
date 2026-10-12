import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ run: vi.fn(), report: vi.fn(), open: vi.fn() }));
vi.mock("@t3tools/client-runtime/state/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/client-runtime/state/runtime")>()),
  runAtomCommand: mocks.run,
}));
vi.mock("../../../rpc/atomRegistry", () => ({ appAtomRegistry: {} }));
vi.mock("../../../state/server", () => ({
  serverEnvironment: { peerOwnership: { setTaskOwner: "set-task-owner" } },
}));
vi.mock("../workFeedback", () => ({ reportFailure: mocks.report }));
vi.mock("./ownerDialog", () => ({ openOwnerDialog: mocks.open }));

import { taskMenu } from "./taskMenu";
import { BOB, CYRIL, ENV, EVA, slotProps, type Looking } from "./ownership.testkit";

afterEach(() => {
  vi.clearAllMocks();
});

const items = (email: string, id: string, looking?: Looking) =>
  taskMenu(slotProps(email, id, looking)).map((entry) => entry.item.label);

describe("the owner items of a task's menu", () => {
  it("offers each person only what they may do", () => {
    expect(items(BOB, "vl9")).toEqual(["Hand over…", "Give back"]);
    expect(items(EVA, "vl9")).toEqual(["Set owner…"]);
    expect(items(CYRIL, "vl9")).toEqual([]);
    expect(items(CYRIL, "vl9", { workspace: "admin" })).toEqual(["Set owner…"]);
  });

  it("offers nothing where ownership is not known for the project", () => {
    expect(items(EVA, "vl9", { ownership: null })).toEqual([]);
  });

  it("sets the owner items apart from the menu's own, whoever sees them first", () => {
    const entries = taskMenu(slotProps(BOB, "vl9"));
    expect(entries.map((entry) => entry.item.separatorBefore)).toEqual([true, undefined]);
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
