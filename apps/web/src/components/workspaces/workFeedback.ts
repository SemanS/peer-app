import { settlePromise, type AtomCommandResult } from "@t3tools/client-runtime/state/runtime";

import { readLocalApi } from "../../localApi";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { failureMessage } from "./WorkspaceAccess";

/** Tells the person why a command failed, in a toast; true when it did not fail. */
export function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>): boolean {
  const message = failureMessage(result);
  if (message !== null) {
    toastManager.add(stackedThreadToast({ type: "error", title, description: message }));
  }
  return message === null;
}

/** Asks the person to confirm through the app's dialog; true where there is none to ask with. */
export async function confirmed(message: string, destructive = false): Promise<boolean> {
  const api = readLocalApi();
  if (api === undefined) return true;
  const answer = await settlePromise(() =>
    api.dialogs.confirm(message, destructive ? { variant: "destructive" } : undefined),
  );
  return answer._tag === "Success" && answer.value;
}
