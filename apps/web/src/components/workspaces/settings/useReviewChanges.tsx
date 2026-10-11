import type { PeerSettingsSaved } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { ReviewChangesDialog } from "./ReviewChangesDialog";
import type { ReviewOperation, SavedOutcome } from "./reviewChanges.logic";

interface Reviewing {
  readonly operation: ReviewOperation;
  readonly scope: string;
  readonly context: ReactNode;
}

/**
 * Opens the review of a change from a page: `open(operation)` starts one, and `dialog` is what to
 * render (it is null while none is open). A draft's operation is `useSettingsDraft().operation`;
 * `onSaved` is where the page drops its draft (`draft.saved`). `scope` is what the changes are to,
 * in the title ("Booking"); a review of another thing (a revision to revert, a proposal) says its own.
 */
export function useReviewChanges({
  scope,
  onSaved,
  onNothingToSave,
}: {
  readonly scope: string;
  readonly onSaved?: ((saved: PeerSettingsSaved, outcome: SavedOutcome) => void) | undefined;
  /** A review of a draft found nothing left to save and was closed with Done: drop the draft. */
  readonly onNothingToSave?: (() => void) | undefined;
}) {
  const [reviewing, setReviewing] = useState<Reviewing | null>(null);
  return {
    open: (
      operation: ReviewOperation | null,
      extras: { readonly scope?: string; readonly context?: ReactNode } = {},
    ) => {
      if (operation === null) return;
      setReviewing({ operation, scope: extras.scope ?? scope, context: extras.context });
    },
    dialog:
      reviewing === null ? null : (
        <ReviewChangesDialog
          operation={reviewing.operation}
          scope={reviewing.scope}
          context={reviewing.context}
          onSaved={onSaved}
          onNothingToSave={reviewing.operation.kind === "save" ? onNothingToSave : undefined}
          onClose={() => setReviewing(null)}
        />
      ),
  };
}
