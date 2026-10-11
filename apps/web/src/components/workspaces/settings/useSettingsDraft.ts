import { getAt, jsonEqual } from "@t3tools/client-runtime/peer-settings";
import type { PeerSettingsSaved, PeerSettingsSet } from "@t3tools/contracts";
import { useState } from "react";

import type { ReviewOperation, SavedOutcome } from "./reviewChanges.logic";
import {
  draftSets,
  edit,
  isStale,
  landed,
  standing,
  unsaved,
  type DraftState,
  type Live,
} from "./settingsDraft.logic";
import type { SettingsDocument } from "./settingsView.logic";
import type { SettingsView } from "./useSettingsView";

type Path = ReadonlyArray<string>;

export interface SettingsDraftOptions {
  /**
   * The part of the document the page edits, as a path (`["projects", "booking"]`). The draft's
   * `value`, `get`, `set` and `changed` speak in paths below it, and only changes below it count.
   * Without it the page edits the whole document.
   */
  readonly slice?: Path;
  /**
   * Nodes below the slice whose whole value is sent when anything under them changed, for a page
   * that edits a part as one (the tools list, say). By default a change is sent at the node that
   * changed, and a list as a whole; the Hub merges what others changed meanwhile either way.
   */
  readonly granularity?: ReadonlyArray<Path>;
}

export interface SettingsDraft {
  /** The slice of the draft (the whole document without one); undefined until read, or where there is none. */
  readonly value: unknown;
  /** The whole document with the draft's changes. */
  readonly document: SettingsDocument | null;
  /** The node at `path` below the slice, as the draft has it. */
  readonly get: (path: Path) => unknown;
  /** Sets the node at `path` below the slice; `undefined` removes it. */
  readonly set: (path: Path, value: unknown) => void;
  /** Whether the draft has changed the node at `path` below the slice (a "Not saved" mark). */
  readonly changed: (path: Path) => boolean;
  /** How many leaves the draft has changed; 0 hides the bar. */
  readonly dirty: number;
  /** The settings changed since the draft started: the bar says so, and the review merges. */
  readonly stale: boolean;
  /** The revision the draft started from. */
  readonly base: number | null;
  /** Drops the draft, so the page follows the view again. */
  readonly discard: () => void;
  /**
   * Call with what a review saved (`useReviewChanges`' `onSaved`): the draft stands in for the new
   * revision until the view has it, or is dropped at once when some of its changes were given up.
   */
  readonly saved: (saved: PeerSettingsSaved, outcome?: SavedOutcome) => void;
  /** The sets that save the draft, against `base`. */
  readonly sets: () => PeerSettingsSet[];
  /** What to review to save it (`useReviewChanges().open`), or null while there is nothing to save. */
  readonly operation: ReviewOperation | null;
}

/**
 * A page's draft of its part of a workspace's settings. It starts from the document at one
 * revision and keeps that as its base, so a save can be merged with what others saved meanwhile:
 * while it has no change in it, it follows the view; once it has one, a newer revision only marks
 * it `stale`. Leaving the page drops it.
 */
export function useSettingsDraft(
  view: SettingsView,
  options: SettingsDraftOptions = {},
): SettingsDraft {
  const slice = options.slice ?? [];
  const coarse = (options.granularity ?? []).map((path) => [...slice, ...path]);
  const key = `${view.workspace}\u0000${slice.join("\u0000")}`;
  const live: Live | null =
    view.document === null || view.revision === null
      ? null
      : { revision: view.revision, document: view.document };
  const [state, setState] = useState<DraftState | null>(null);
  const current = view.hubHasSettings ? standing(state, key, live) : null;
  const document = current?.document ?? live?.document ?? null;
  const dirty = unsaved(current, slice);
  const sets = () =>
    current === null || dirty === 0 ? [] : draftSets(current.base, current.document, slice, coarse);
  return {
    value: document === null ? undefined : getAt(document, slice),
    document,
    get: (path) => (document === null ? undefined : getAt(document, [...slice, ...path])),
    set: (path, value) => {
      if (!view.hubHasSettings) return;
      setState((previous) =>
        edit(previous, key, live, slice, path, value === null ? undefined : value),
      );
    },
    changed: (path) =>
      current !== null &&
      current.landed === null &&
      !jsonEqual(
        getAt(current.base, [...slice, ...path]),
        getAt(current.document, [...slice, ...path]),
      ),
    dirty,
    stale: isStale(current, live, slice),
    base: current?.revision ?? live?.revision ?? null,
    discard: () => setState(null),
    saved: (result, outcome) => {
      // A draft with changes given up is not what the settings are now, so it is not shown meanwhile.
      setState((previous) =>
        outcome?.dropped === true
          ? null
          : landed(standing(previous, key, live), result.revision?.seq),
      );
      view.refresh();
    },
    sets,
    operation:
      current === null || dirty === 0
        ? null
        : { kind: "save", workspace: view.workspace, base: current.revision, set: sets() },
  };
}
