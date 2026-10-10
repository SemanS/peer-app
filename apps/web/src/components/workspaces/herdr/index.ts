import type { PeerWebPlugin } from "../slots.types";
import { HerdrRuntimeSettings } from "./HerdrRuntimeSettings";
import { showInHerdr } from "./showInHerdr";
import { StartTaskAction } from "./StartTaskAction";
import { StartTaskAgent } from "./StartTaskAgent";
import { herdrMenuItem } from "./threadMenu";

/** herdr agents: starting an agent on a task, its page, and showing it in herdr. */
export const herdrWebPlugin: PeerWebPlugin = {
  id: "herdr",
  needsYou: {
    // herdr's agents show up in Needs you too, which is worth saying while there are none.
    emptyText: (status, { running }) =>
      running > 0 || status.agents.herdr === "running"
        ? null
        : "Nothing needs you. Agents you run in herdr (herdr.dev) show up here too.",
  },
  settings: HerdrRuntimeSettings,
  taskActions: StartTaskAction,
  threadMenu: (thread, environmentId) => {
    const item = herdrMenuItem(thread);
    if (item === null || environmentId === null || thread.open?.kind !== "herdr") return [];
    const { paneId } = thread.open;
    return [{ item, place: "start", run: () => void showInHerdr(environmentId, paneId) }];
  },
  taskLauncher: StartTaskAgent,
};
