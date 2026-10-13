/**
 * Where the Team page is, and how to get there from places that have no router at hand. A task's
 * menu gives the plugin an item and a function to run, so "See the owner map" asks for the page
 * through a request that the plugin's background slot (mounted once, inside the router) carries
 * out; components with a router navigate themselves through `openTeam`.
 */
import { create } from "zustand";

import type { PeerNavigate } from "../slots.types";

/** The two views of the page: the team at a glance, and the project's owner map. */
export type TeamPageView = "team" | "owner-map";

/** The one value of the address's `view` that is not the page itself. */
export const OWNER_MAP_VIEW = "owner-map";

/** The search of the Team page's address: a project's owner map is `?view=owner-map`. */
export interface TeamSearch {
  readonly view?: typeof OWNER_MAP_VIEW;
}

/** What an address's search says the page shows; anything it does not know is the page itself. */
export function teamSearchOf(search: Readonly<Record<string, unknown>>): TeamSearch {
  return search.view === OWNER_MAP_VIEW ? { view: OWNER_MAP_VIEW } : {};
}

/** A project's Team page, or its owner map. */
export interface TeamTarget {
  readonly workspace: string;
  readonly project: string;
  readonly view?: TeamPageView;
}

/** Opens the Team page of a project, or its owner map. */
export function openTeam(navigate: PeerNavigate, target: TeamTarget): void {
  void navigate({
    to: "/team/$workspace/$project",
    params: { workspace: target.workspace, project: target.project },
    search: target.view === "owner-map" ? { view: OWNER_MAP_VIEW } : {},
  });
}

const useTeamRequestStore = create<{ readonly target: TeamTarget | null }>(() => ({
  target: null,
}));

/** The page somebody asked for from a menu, until the background slot has opened it. */
export const useTeamRequest = () => useTeamRequestStore((state) => state.target);

export function requestTeamPage(target: TeamTarget): void {
  useTeamRequestStore.setState({ target });
}

export function clearTeamRequest(): void {
  useTeamRequestStore.setState({ target: null });
}
