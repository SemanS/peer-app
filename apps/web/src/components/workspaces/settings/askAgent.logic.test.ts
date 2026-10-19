import { ProjectId, type PeerProjectState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { askCheckout, askPageOf, askPrompt } from "./askAgent.logic";
import { parsePeerSettingsPath } from "./peerSettings.logic";

const acme = { slug: "acme", name: "Acme" };

describe("the prompt an agent is asked with", () => {
  it("asks for a project's settings as design A7 words it", () => {
    expect(
      askPrompt({
        workspace: acme,
        scope: { kind: "project", id: "booking", name: "Booking" },
        text: "make migrations exclusive",
      }),
    ).toBe(
      'Change Peer settings for Booking in Acme: make migrations exclusive. Read them with `peer config show --project booking --workspace acme`, edit only what this needs, and save it with `peer config save --file <file> --why "<one line>"`. If Peer says I do not own a field, propose it instead with `peer config propose` and the same flags.',
    );
  });

  it("asks for the workspace's own settings with --all", () => {
    expect(
      askPrompt({
        workspace: acme,
        scope: { kind: "workspace" },
        text: "add Sentry to the tool catalog",
      }),
    ).toBe(
      'Change Peer settings for the whole workspace in Acme: add Sentry to the tool catalog. Read them with `peer config show --all --workspace acme`, edit only what this needs, and save it with `peer config save --file <file> --why "<one line>"`. If Peer says I do not own a field, propose it instead with `peer config propose` and the same flags.',
    );
  });

  it("trims the person's words and does not double their full stop", () => {
    const prompt = askPrompt({
      workspace: acme,
      scope: { kind: "workspace" },
      text: "  lower the budget. \n",
    });
    expect(prompt).toContain("in Acme: lower the budget. Read them");
    expect(prompt).not.toContain("..");
  });

  it("keeps a question mark or other ending the person chose", () => {
    expect(
      askPrompt({ workspace: acme, scope: { kind: "workspace" }, text: "can Ana lead Booking?" }),
    ).toContain("can Ana lead Booking?. Read them");
  });
});

describe("where the thread starts", () => {
  const project = (
    id: string,
    repositories: ReadonlyArray<{ state: string; projectId?: string }>,
  ) =>
    ({
      project: { id, name: id.toUpperCase() },
      repositories: repositories.map((repository, index) => ({
        id: `r${index}`,
        url: "https://github.com/acme/x",
        branch: "main",
        path: "/x",
        state: repository.state,
        ...(repository.projectId === undefined
          ? {}
          : { projectId: ProjectId.make(repository.projectId) }),
      })),
    }) as unknown as PeerProjectState;

  const booking = project("booking", [{ state: "ready", projectId: "t3-booking" }]);
  const camp = project("camp-bot", [{ state: "ready", projectId: "t3-camp" }]);
  const cold = project("peer-hub", [{ state: "missing" }]);

  it("is the project's own checkout when it has one", () => {
    expect(askCheckout([camp, booking], "booking")).toEqual({
      projectId: "t3-booking",
      name: "BOOKING",
    });
  });

  it("is another project's checkout of the workspace when the project has none here", () => {
    expect(askCheckout([cold, camp], "peer-hub")).toEqual({
      projectId: "t3-camp",
      name: "CAMP-BOT",
    });
    expect(askCheckout([cold, camp], undefined)).toEqual({
      projectId: "t3-camp",
      name: "CAMP-BOT",
    });
  });

  it("is nowhere while nothing is cloned and opened, or a clone is still under way", () => {
    expect(askCheckout([cold], "peer-hub")).toBeNull();
    expect(askCheckout([project("a", [{ state: "cloning", projectId: "t3-a" }])], "a")).toBeNull();
    expect(askCheckout([], undefined)).toBeNull();
  });
});

describe("which pages offer to ask an agent", () => {
  const at = (path: string) => askPageOf(parsePeerSettingsPath(path));

  it("are the workspace pages that hold settings an agent can propose changes to", () => {
    for (const section of ["general", "people", "capacity", "tools", "integrations"]) {
      expect(at(`/settings/peer/w/acme/${section}`)).toBe("acme");
    }
  });

  it("are not the pages of what no agent proposes: secrets, records, a form of its own, the person's own", () => {
    for (const section of ["secrets", "audit", "hub", "new-project", "plans", "keys", "slack"]) {
      expect(at(`/settings/peer/w/acme/${section}`)).toBeNull();
    }
  });

  it("are not a project's pages, which have it in their header, nor this computer's", () => {
    expect(at("/settings/peer/w/acme/project/booking/basics")).toBeNull();
    expect(at("/settings/peer/computer/coordination")).toBeNull();
    expect(at("/settings/peer")).toBeNull();
    expect(askPageOf(null)).toBeNull();
  });

  it("name the workspace the page is of", () => {
    expect(at("/settings/peer/w/camp-bot/general")).toBe("camp-bot");
  });
});
