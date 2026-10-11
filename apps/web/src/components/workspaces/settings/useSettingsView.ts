import {
  inactivePluginReason,
  type InactivePluginReason,
} from "@t3tools/client-runtime/peer/plugins";
import type { PeerSettingsRights, PeerSettingsView } from "@t3tools/contracts";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { usePeerSettings } from "./PeerSettingsContext";
import {
  canChangePath,
  knownRevision,
  ownersOfPath,
  personName,
  type SettingsDocument,
  type SettingsPerson,
} from "./settingsView.logic";
import { useRetained } from "./useRetained";

/** One workspace's settings as the signed-in person may see them, and what they may do with them. */
export interface SettingsView {
  /** The workspace's slug. */
  readonly workspace: string;
  /**
   * The settings plugin is active here: the Hub serves the `settings` feature and its owner left the
   * plugin on. Without it a page shows today's read-only view from the manifest, and says where an
   * edit would be that it needs a newer Peer Hub (`SettingsUnavailableNote`).
   */
  readonly hubHasSettings: boolean;
  /** Why the plugin is not active: the Hub lacks the feature (`hub`), its owner turned it off, …; null while it is. */
  readonly unavailable: InactivePluginReason | null;
  /** The first read is on its way. */
  readonly loading: boolean;
  /** Why nothing has been read; null while there is a view, or one is on its way. */
  readonly error: string | null;
  /** The visible part of the document; null until read. */
  readonly document: SettingsDocument | null;
  /** The revision the document is at ("revision 42"); null until read. */
  readonly revision: number | null;
  readonly rights: PeerSettingsRights | null;
  readonly features: PeerSettingsView["features"] | null;
  /** The workspace's members, who the view names people by. */
  readonly people: ReadonlyArray<SettingsPerson & { readonly role: "owner" | "admin" | "member" }>;
  /** The signed-in address. */
  readonly me: string | null;
  /**
   * Whether the person may change the node at `path`: false while settings are unavailable or not
   * yet read. The Hub decides every change; this only gates controls.
   */
  readonly canChange: (path: ReadonlyArray<string>) => boolean;
  /** Who may change it, in the Hub's words ("admins", "Booking's leads and admins"). */
  readonly ownersOf: (path: ReadonlyArray<string>) => string;
  /** How to call a person: the name the people list gives their address, else the one they carried. */
  readonly nameOf: (person: {
    readonly email: string;
    readonly name?: string | undefined;
  }) => string;
  /** Reads the view again now. */
  readonly refresh: () => void;
}

const NO_PEOPLE: SettingsView["people"] = [];

/**
 * The view of one workspace's settings: the document, the person's rights, the revision. It reads
 * when the status says the workspace's revision moved, and keeps what it has read while it does.
 * Needs the Peer settings context, so only the area's pages and the parts they hold use it.
 */
export function useSettingsView(workspace: string): SettingsView {
  const { environmentId, status } = usePeerSettings();
  const me = status.email;
  const unavailable = inactivePluginReason(status, "settings");
  const revision = knownRevision(status, workspace);
  const query = useEnvironmentQuery(
    unavailable === null && me !== null
      ? serverEnvironment.peerSettings.view({
          environmentId,
          person: me,
          input: revision === undefined ? { workspace } : { workspace, revision },
        })
      : null,
  );
  const view = useRetained(query.data, `${environmentId}/${me ?? ""}/${workspace}`);
  const people = view?.people ?? NO_PEOPLE;
  return {
    workspace,
    hubHasSettings: unavailable === null,
    unavailable,
    loading: unavailable === null && view === null && query.error === null,
    error: view === null ? query.error : null,
    document: view?.document ?? null,
    revision: view?.revision.seq ?? null,
    rights: view?.rights ?? null,
    features: view?.features ?? null,
    people,
    me,
    canChange: (path) =>
      unavailable === null &&
      view !== null &&
      canChangePath({ rights: view.rights, email: me, document: view.document }, path),
    ownersOf: (path) => ownersOfPath(view?.document ?? {}, path),
    nameOf: (person) => personName(people, person),
    refresh: query.refresh,
  };
}
