import { describe, expect, it, vi } from "vite-plus/test";

import { OWNER_MAP_VIEW, openTeam, teamSearchOf } from "./teamNavigation";

describe("the Team page's address", () => {
  it("reads the owner map from the search, and anything it does not know as the page itself", () => {
    expect(teamSearchOf({ view: "owner-map" })).toEqual({ view: OWNER_MAP_VIEW });
    expect(teamSearchOf({})).toEqual({});
    expect(teamSearchOf({ view: "people" })).toEqual({});
    expect(teamSearchOf({ view: ["owner-map"] })).toEqual({});
    expect(teamSearchOf({ other: "owner-map" })).toEqual({});
  });

  it("opens a project's Team page, or its owner map, by workspace and project", () => {
    const navigate = vi.fn();
    openTeam(navigate as never, { workspace: "acme", project: "ordering" });
    expect(navigate).toHaveBeenLastCalledWith({
      to: "/team/$workspace/$project",
      params: { workspace: "acme", project: "ordering" },
      search: {},
    });
    openTeam(navigate as never, { workspace: "acme", project: "ordering", view: "owner-map" });
    expect(navigate).toHaveBeenLastCalledWith({
      to: "/team/$workspace/$project",
      params: { workspace: "acme", project: "ordering" },
      search: { view: "owner-map" },
    });
    openTeam(navigate as never, { workspace: "acme", project: "ordering", view: "team" });
    expect(navigate).toHaveBeenLastCalledWith(expect.objectContaining({ search: {} }));
  });
});
