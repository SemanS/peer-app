/**
 * Which acceptance dialog is open, and for which task. A task's menu hands the plugin only an item
 * and a function to run, so the dialog is mounted once, at the root, by the plugin's background
 * slot, and this store says which one is wanted: the menu, a row's action or the card opens it, the
 * dialog closes it.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";

export interface AcceptanceDialogTarget {
  readonly kind: "accept" | "withdraw";
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
  readonly task: string;
}

const useAcceptanceDialogStore = create<{ readonly target: AcceptanceDialogTarget | null }>(() => ({
  target: null,
}));

export const useAcceptanceDialog = () => useAcceptanceDialogStore((state) => state.target);

export function openAcceptanceDialog(target: AcceptanceDialogTarget): void {
  useAcceptanceDialogStore.setState({ target });
}

export function closeAcceptanceDialog(): void {
  useAcceptanceDialogStore.setState({ target: null });
}
