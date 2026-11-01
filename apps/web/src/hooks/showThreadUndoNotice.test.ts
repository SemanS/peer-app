import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { toastManager } from "../components/ui/toast";
import { announce, cancelAnnouncement } from "../lib/announce";
import {
  undoLatestThreadAction,
  showThreadUndoNotice,
  threadUndoClaimsShortcut,
  useThreadUndoNotice,
} from "./showThreadUndoNotice";
import * as ThreadUndo from "@t3tools/client-runtime/state/thread-undo";

vi.mock("../lib/announce", () => ({ announce: vi.fn(), cancelAnnouncement: vi.fn() }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup() {
  const add = vi.spyOn(toastManager, "add").mockReturnValue("error-toast");
  const undo = vi.fn(async () => AsyncResult.success(undefined));
  const claim = ThreadUndo.begin("pin", "env/thread");
  const options = { action: "Unpinned" as const, failureTitle: "Restore failed", undo, claim };
  return { add, undo, claim, options };
}

function notice() {
  const value = useThreadUndoNotice.getState().notice;
  if (!value) throw new Error("Undo notice is missing");
  return value;
}

describe("thread undo notice", () => {
  it("aggregates consecutive actions without success toasts and restores the group once", async () => {
    const { add, undo, options } = setup();
    showThreadUndoNotice({
      ...options,
      action: "Finished",
      claim: ThreadUndo.begin("settle", "env/a"),
    });
    showThreadUndoNotice({
      ...options,
      action: "Finished",
      claim: ThreadUndo.begin("settle", "env/b"),
    });
    expect(notice()).toMatchObject({ action: "Finished", count: 2 });
    expect(add).not.toHaveBeenCalled();
    const group = notice();
    await group.undo();
    await group.undo();
    expect(undo).toHaveBeenCalledTimes(2);
    expect(undoLatestThreadAction()).toBe(false);
  });

  it("drops invalidated claims immediately and rejects a captured stale undo", async () => {
    const { undo, options } = setup();
    showThreadUndoNotice(options);
    const stale = notice();
    ThreadUndo.invalidate("pin", "env/thread");
    expect(useThreadUndoNotice.getState().notice).toBeNull();
    showThreadUndoNotice({ ...options, claim: ThreadUndo.begin("pin", "env/thread") });
    await stale.undo();
    expect(undo).not.toHaveBeenCalled();
    await notice().undo();
    expect(undo).toHaveBeenCalledOnce();
  });

  it("claims mod+z from text fields until the user types, then again for a new notice", async () => {
    const { options } = setup();
    const older = vi.fn(async () => AsyncResult.success(undefined));
    const newer = vi.fn(async () => AsyncResult.success(undefined));
    showThreadUndoNotice({
      ...options,
      action: "Finished",
      undo: older,
      claim: ThreadUndo.begin("settle", "env/a"),
    });
    showThreadUndoNotice({
      ...options,
      action: "Snoozed",
      undo: newer,
      claim: ThreadUndo.begin("snooze", "env/b"),
    });
    expect(undoLatestThreadAction()).toBe(true);
    expect(newer).toHaveBeenCalledOnce();
    expect(older).not.toHaveBeenCalled();
    expect(notice().action).toBe("Finished");
    await notice().undo();
    expect(threadUndoClaimsShortcut()).toBe(false);
    showThreadUndoNotice({ ...options, claim: ThreadUndo.begin("pin", "env/expiring") });
    vi.advanceTimersByTime(5_000);
    expect(threadUndoClaimsShortcut()).toBe(false);
  });

  it("announces each new summary once, and cancels it when the notice clears", async () => {
    const { options } = setup();
    vi.mocked(announce).mockClear();
    vi.mocked(cancelAnnouncement).mockClear();
    showThreadUndoNotice(options);
    expect(announce).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/^Unpinned 1 thread, /),
      "thread-undo-notice",
    );
    ThreadUndo.invalidate("pin", "env/other");
    expect(announce).toHaveBeenCalledOnce();
    showThreadUndoNotice({ ...options, claim: ThreadUndo.begin("pin", "env/second") });
    expect(announce).toHaveBeenLastCalledWith(
      expect.stringMatching(/^Unpinned 2 threads, /),
      "thread-undo-notice",
    );
    await notice().undo();
    expect(cancelAnnouncement).toHaveBeenCalledWith("thread-undo-notice");
  });
});
