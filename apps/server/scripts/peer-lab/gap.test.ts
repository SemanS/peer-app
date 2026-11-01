// @effect-diagnostics nodeBuiltinImport:off - host-side lab fixture.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  GAP_A_PROMPT,
  GAP_B_PROMPT,
  GAP_B_SOFT_PROMPT,
  GAP_SEED,
  aboutGap,
  measure,
  serves,
  writeGapSeed,
} from "./gap.ts";
import type { LabItem } from "./handoffSteps.ts";

const gap = "nothing serves public/index.html from src/server.ts";
const browser: LabItem = { kind: "unverified", text: "the page was not opened in a browser" };

describe("the scenario", () => {
  it("names neither the seam nor Peer's way to report it", () => {
    for (const text of [
      GAP_A_PROMPT,
      GAP_B_PROMPT,
      GAP_B_SOFT_PROMPT,
      ...Object.values(GAP_SEED),
    ]) {
      expect(text).not.toMatch(/blockers?\b|\bstatic\b|@task/i);
    }
  });

  it("tells the seam from the page's other unknowns", () => {
    expect(aboutGap(gap)).toBe(true);
    expect(aboutGap("GET / answers 404: the API does not serve the page")).toBe(true);
    expect(aboutGap("no static file serving in the server")).toBe(true);
    expect(aboutGap(browser.text)).toBe(false);
    expect(aboutGap("node --test test/page.test.ts passes")).toBe(false);
  });
});

describe("measure", () => {
  const nothing = { items: [browser], blockers: [], lines: [], changedServer: false };

  it("reads a gap written only under Blockers as prose", () => {
    expect(measure({ ...nothing, blockers: [gap], lines: [gap] })).toEqual({
      noticed: true,
      owned: false,
      person: null,
      onlyInProse: true,
      blockers: 1,
      changedServer: false,
    });
  });

  it("reads a gap named under State or Decisions as noticed, and as prose", () => {
    expect(measure({ ...nothing, lines: [gap] })).toMatchObject({
      noticed: true,
      onlyInProse: true,
      blockers: 0,
    });
  });

  it("reads a gap an item leaves with a person, or a task, as owned", () => {
    const person: LabItem = { kind: "unverified", text: gap, owner: "bob@acme.test" };
    expect(measure({ ...nothing, items: [browser, person] })).toMatchObject({
      noticed: true,
      owned: true,
      person: "bob@acme.test",
      onlyInProse: false,
    });
    const task: LabItem = { kind: "unverified", text: gap, task: "t-1" };
    expect(measure({ ...nothing, items: [task] })).toMatchObject({ owned: true, person: null });
  });

  it("counts an item nobody answers for as named, not owned", () => {
    const unowned: LabItem = { kind: "unverified", text: gap };
    expect(measure({ ...nothing, items: [unowned] })).toMatchObject({
      noticed: true,
      owned: false,
      onlyInProse: true,
    });
  });

  it("does not take a passed check for the gap, or a report for having one", () => {
    const passed: LabItem = { kind: "pass", text: gap };
    expect(measure({ ...nothing, items: [passed] }).noticed).toBe(false);
    expect(
      measure({ items: undefined, blockers: [], lines: [], changedServer: true }),
    ).toMatchObject({
      noticed: false,
      changedServer: true,
    });
  });
});

describe("serves", () => {
  it("fails the seed's server and passes one that serves the page", async () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-lab-gap-"));
    writeGapSeed(root);
    expect(await serves(root)).toBe(false);
    NodeFS.writeFileSync(
      NodePath.join(root, "src/server.ts"),
      [
        'import { createServer } from "node:http";',
        "createServer((request, response) => {",
        '  response.end(request.url === "/" ? `<ul id="splits"></ul>` : "x");',
        "}).listen(Number(process.env.PORT));",
        "",
      ].join("\n"),
    );
    expect(await serves(root)).toBe(true);
    NodeFS.rmSync(root, { recursive: true, force: true });
  });
});
