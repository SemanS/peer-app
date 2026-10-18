import type { JujutsuState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { jujutsuCard } from "./settings.logic";

const connected: JujutsuState = {
  connection: "connected",
  version: "0.46.0",
  agentWorkspaces: 2,
  protection: true,
};

describe("the Jujutsu workspaces card", () => {
  it("says jj 0.46.0 with two agent workspaces and protection on", () => {
    expect(jujutsuCard(connected, { active: true })).toEqual({
      word: "Connected",
      line: "Connected · jj 0.46.0 · 2 agent workspaces",
      showRows: true,
      protectionEditable: true,
      protection: true,
    });
  });

  it("says Off with no rows while the plugin is off", () => {
    expect(jujutsuCard(undefined, { active: false })).toMatchObject({
      word: "Off",
      line: "Off",
      showRows: false,
      protectionEditable: false,
    });
  });

  it("says Not available with the cause when jj is missing, and leaves protection alone", () => {
    const card = jujutsuCard(
      { ...connected, connection: "notAvailable", problem: "missing" },
      { active: true },
    );
    expect(card.line).toBe("Not available · Jujutsu is not on this computer");
    expect(card.protectionEditable).toBe(false);
  });

  it("says Problem for a jj older than Peer needs", () => {
    expect(
      jujutsuCard(
        { ...connected, connection: "notAvailable", problem: "tooOld", version: "0.38.0" },
        { active: true },
      ).word,
    ).toBe("Problem");
  });

  it("shows protection off when the status says so", () => {
    expect(jujutsuCard({ ...connected, protection: false }, { active: true }).protection).toBe(
      false,
    );
  });
});
