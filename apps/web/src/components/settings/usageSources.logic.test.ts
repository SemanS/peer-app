import { describe, expect, it } from "vite-plus/test";

import { searchableSetting, searchSettings } from "./settingsSearch";
import { peerHubHost, usageSourcesNote } from "./usageSources.logic";

describe("the Usage limit sources note", () => {
  it("says a source is not the Peer Hub, and where the Peer Hub is connected", () => {
    expect(usageSourcesNote({ hubUrl: "https://hub.example.com", signedIn: true })).toBe(
      "Reads your rate limits from a CLIProxyAPI server you run, for the Limits view. This isn’t your Peer Hub: hub.example.com is connected under Workspace › Hub.",
    );
  });

  it("keeps a port in the host it names", () => {
    expect(peerHubHost({ hubUrl: "http://localhost:5190/", signedIn: true })).toBe(
      "localhost:5190",
    );
  });

  it("still says a source is no Peer Hub where none is connected", () => {
    const note =
      "Reads your rate limits from a CLIProxyAPI server you run, for the Limits view. It is not a Peer Hub.";
    expect(usageSourcesNote(null)).toBe(note);
    expect(usageSourcesNote(undefined)).toBe(note);
    // A hub the environment is not signed in to is not connected.
    expect(usageSourcesNote({ hubUrl: "https://hub.example.com", signedIn: false })).toBe(note);
  });

  it("names a hub address it cannot read as it is", () => {
    expect(peerHubHost({ hubUrl: "hub.example.com", signedIn: true })).toBe("hub.example.com");
  });
});

describe("the Usage limit sources section in settings search", () => {
  it("is titled by its new name, and found by it and by the one it had", () => {
    expect(searchableSetting("usage-providers").title).toBe("Usage limit sources");
    for (const query of ["usage limit sources", "usage providers"]) {
      expect(searchSettings(query)[0]).toMatchObject({
        id: "usage-providers",
        to: "/settings/providers",
      });
    }
  });
});
