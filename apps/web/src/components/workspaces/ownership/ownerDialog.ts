/**
 * Which owner dialog is open, and for which task. A task's menu (on its page and in the sidebar's
 * row) hands the plugin only an item and a function to run, so the dialogs it opens are mounted
 * once, at the root, by the plugin's background slot, and this store says which one is wanted:
 * the menu opens it, the dialog closes it.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";

export type OwnerDialogKind = "set" | "hand-over";

/** The task a dialog is about, by ids, so the dialog reads the status as it is while it is open. */
export interface OwnerDialogTarget {
  readonly kind: OwnerDialogKind;
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
  readonly task: string;
}

const useOwnerDialogStore = create<{ readonly target: OwnerDialogTarget | null }>(() => ({
  target: null,
}));

/** The dialog that is open, or null. */
export const useOwnerDialog = () => useOwnerDialogStore((state) => state.target);

export function openOwnerDialog(target: OwnerDialogTarget): void {
  useOwnerDialogStore.setState({ target });
}

export function closeOwnerDialog(): void {
  useOwnerDialogStore.setState({ target: null });
}
