import { Button } from "../../ui/button";
import { changesText } from "./settingsDraft.logic";
import type { SettingsDraft } from "./useSettingsDraft";
import { useReviewChanges } from "./useReviewChanges";

const NO_NOTES: ReadonlyArray<string> = [];

/**
 * The bar at the foot of a page with unsaved changes (design artboards 04 and 09): how many there
 * are, what saving will do beyond the changes themselves, Discard, and Review & save, which opens
 * the review. It sticks to the bottom of the page while the page scrolls, and is not there while the
 * draft is clean.
 */
export function DraftBar({
  count,
  scope,
  notes,
  stale = false,
  onDiscard,
  onReview,
}: {
  /** The draft's unsaved changes (`useSettingsDraft().dirty`); the bar is hidden at 0. */
  readonly count: number;
  /** What they are changes to, after the count: "Booking · People". */
  readonly scope?: string | undefined;
  /** What saving does that the changes do not say: "Saving adds Sentry for 5 people…". */
  readonly notes?: ReadonlyArray<string> | undefined;
  /** The settings changed since the draft started (`useSettingsDraft().stale`). */
  readonly stale?: boolean | undefined;
  readonly onDiscard: () => void;
  readonly onReview: () => void;
}) {
  if (count <= 0) return null;
  return (
    <section
      aria-label="Unsaved changes"
      className="sticky bottom-4 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-popover px-4 py-2.5 shadow-lg/10"
    >
      <div className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
        <p className="font-medium text-foreground">{changesText(count, scope)}</p>
        {stale ? (
          <p className="flex items-start gap-2 text-muted-foreground">
            <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-warning" />
            Settings changed since you started
          </p>
        ) : null}
        {[...new Set(notes ?? NO_NOTES)].map((note) => (
          <p key={note} className="flex items-start gap-2 text-muted-foreground">
            <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-info" />
            <span className="min-w-0">{note}</span>
          </p>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onDiscard}>
          Discard
        </Button>
        <Button size="sm" onClick={onReview}>
          Review &amp; save
        </Button>
      </div>
    </section>
  );
}

/**
 * A page's draft, with everything that saves it: the bar while the draft has changes, and the review
 * its "Review & save" opens, which drops the draft once it saved. Put it directly in the page (not
 * inside a part of it that ends early, or the bar cannot stick to the bottom) and render it always,
 * not only while the draft is dirty: the review stays open after the draft is gone.
 */
export function DraftSaveBar({
  draft,
  scope,
  label,
  notes,
}: {
  readonly draft: Pick<SettingsDraft, "dirty" | "stale" | "discard" | "saved" | "operation">;
  /** What the changes are to, in the review's title: "Booking". */
  readonly scope: string;
  /** What the bar says they are to, after the count: "Booking · People". Defaults to `scope`. */
  readonly label?: string | undefined;
  /** What saving does beyond the changes ("Saving adds Sentry for 5 people…"). */
  readonly notes?: ReadonlyArray<string> | undefined;
}) {
  const review = useReviewChanges({
    scope,
    onSaved: draft.saved,
    onNothingToSave: draft.discard,
  });
  return (
    <>
      <DraftBar
        count={draft.dirty}
        scope={label ?? scope}
        notes={notes}
        stale={draft.stale}
        onDiscard={draft.discard}
        onReview={() => review.open(draft.operation)}
      />
      {review.dialog}
    </>
  );
}
