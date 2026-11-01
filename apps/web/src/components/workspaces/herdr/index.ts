import type { PeerWebPlugin } from "../slots.types";
import { HerdrRuntimeSettings } from "./HerdrRuntimeSettings";
import { StartTaskAction } from "./StartTaskAction";

/** herdr agents: starting an agent on a task, and the runtime they run in. */
export const herdrWebPlugin: PeerWebPlugin = {
  id: "herdr",
  settings: HerdrRuntimeSettings,
  taskActions: StartTaskAction,
};
