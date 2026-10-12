import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));

import { TeamNavigator } from "./TeamNavigator";
import { clearTeamRequest, requestTeamPage } from "./teamNavigation";

let renderer: ReactTestRenderer | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.navigate.mockReset();
  clearTeamRequest();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
});

describe("opening the Team page from a menu", () => {
  it("opens the page a menu asked for once, and draws nothing", async () => {
    await act(async () => {
      renderer = create(<TeamNavigator />);
    });
    expect(renderer!.toJSON()).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () =>
      requestTeamPage({ workspace: "acme", project: "ordering", view: "owner-map" }),
    );
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/team/$workspace/$project",
      params: { workspace: "acme", project: "ordering" },
      search: { view: "owner-map" },
    });
    // The request is spent: rendering again opens nothing more.
    await act(async () => renderer!.update(<TeamNavigator />));
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
  });

  it("opens a request made before it was mounted", async () => {
    requestTeamPage({ workspace: "acme", project: "ordering" });
    await act(async () => {
      renderer = create(<TeamNavigator />);
    });
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: { workspace: "acme", project: "ordering" }, search: {} }),
    );
  });
});
