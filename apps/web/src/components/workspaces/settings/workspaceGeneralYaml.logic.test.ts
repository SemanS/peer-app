import JSZip from "jszip";
import { describe, expect, it } from "vite-plus/test";

import {
  archiveName,
  arrangeImport,
  buildArchive,
  importContext,
  importSummary,
  readArchive,
  readImport,
  revisionOf,
  sniffFolder,
  type ImportEntry,
  type ImportSource,
} from "./workspaceGeneralYaml.logic";

const entry = (path: string, text: string, size = text.length): ImportEntry => ({
  path,
  size,
  text: () => Promise.resolve(text),
});

const exported = {
  "workspace.yaml": "currency: EUR\n",
  "projects/booking.yaml": "name: Booking\n",
  "projects/camp-bot.yaml": "name: Camp-bot\n",
  "tools/postgres-staging.yaml": "name: Postgres staging\nmcp:\n  command: npx\n",
  "capacity/standard.yaml": "name: Standard\nmodels: []\n",
  ".peer-revision": "42 3f2a9c1e5b7d4e8a9c217d4e5f6a8b90c1d2e3f4\n",
} as const;

describe("what Export saves", () => {
  it("names the archive after the workspace and the revision", () => {
    expect(archiveName("acme", 42)).toBe("acme-settings-r42.zip");
    expect(archiveName("acme", undefined)).toBe("acme-settings.zip");
  });

  it("is one folder with every file in it, as the CLI exports them", async () => {
    const zip = await JSZip.loadAsync(await buildArchive("acme", exported));
    const files = Object.values(zip.files)
      .filter((file) => !file.dir)
      .map((file) => file.name)
      .toSorted();
    expect(files).toEqual([
      "acme-settings/.peer-revision",
      "acme-settings/capacity/standard.yaml",
      "acme-settings/projects/booking.yaml",
      "acme-settings/projects/camp-bot.yaml",
      "acme-settings/tools/postgres-staging.yaml",
      "acme-settings/workspace.yaml",
    ]);
    expect(await zip.file("acme-settings/projects/booking.yaml")?.async("string")).toBe(
      "name: Booking\n",
    );
  });

  it("reads back, through Import, as the files that were exported", async () => {
    const entries = await readArchive(await buildArchive("acme", exported));
    const read = await arrangeImport(entries);
    expect(read).toMatchObject({ ok: true, base: 42, files: exported });
  });
});

describe("the files Import takes", () => {
  it("takes a picked folder, whose files carry the folder's name", async () => {
    const read = await arrangeImport(
      Object.entries(exported).map(([path, text]) => entry(`acme/${path}`, text)),
    );
    expect(read).toMatchObject({
      ok: true,
      base: 42,
      files: exported,
      summary: "workspace.yaml, 2 projects, 1 tool, 1 pool",
    });
  });

  it("finds the folder that holds workspace.yaml inside a picked repository, and reads only what the Hub reads", async () => {
    let read = 0;
    const counted = (path: string, text: string): ImportEntry => ({
      path,
      size: text.length,
      text: () => {
        read += 1;
        return Promise.resolve(text);
      },
    });
    const result = await arrangeImport([
      counted("registry/README.md", "# Registry"),
      counted("registry/.git/HEAD", "ref: refs/heads/main"),
      counted("registry/node_modules/x/package.json", "{}"),
      counted("registry/pnpm-lock.yaml", "lockfileVersion: 9"),
      counted("registry/workspaces/acme/workspace.yaml", "currency: EUR\n"),
      counted("registry/workspaces/acme/projects/booking.yaml", "name: Booking\n"),
      counted("registry/workspaces/acme/notes/todo.yaml", "- x"),
    ]);
    expect(result).toMatchObject({
      ok: true,
      files: { "workspace.yaml": "currency: EUR\n", "projects/booking.yaml": "name: Booking\n" },
    });
    expect(read).toBe(2);
  });

  it("will not guess between two workspaces' folders picked together", async () => {
    expect(
      await arrangeImport([
        entry("registry/acme/workspace.yaml", "currency: EUR\n"),
        entry("registry/other/workspace.yaml", "currency: USD\n"),
      ]),
    ).toEqual({
      ok: false,
      problem: "Those files hold more than one workspace.yaml. Pick the folder of one workspace.",
    });
  });

  it("keeps a `.yml` file's contents but names it as the Hub reads it", async () => {
    const read = await arrangeImport([
      entry("workspace.yml", "currency: USD\n"),
      entry("projects/booking.yml", "name: Booking\n"),
    ]);
    expect(read).toMatchObject({
      ok: true,
      base: undefined,
      files: { "workspace.yaml": "currency: USD\n", "projects/booking.yaml": "name: Booking\n" },
    });
  });

  it("has no revision to start from without .peer-revision, and says so to the review", async () => {
    const read = await arrangeImport([entry("workspace.yaml", "currency: EUR\n")]);
    if (!read.ok) throw new Error("expected files");
    expect(read.base).toBeUndefined();
    expect(importContext(read)).toBe(
      "Importing workspace.yaml. They carry no revision, so every difference from the current settings is a change, including what was saved since they were made.",
    );
  });

  it("says which revision the files start from when it is known", async () => {
    const read = await arrangeImport([
      entry("workspace.yaml", "currency: EUR\n"),
      entry("projects/booking.yaml", "name: Booking\n"),
      entry(".peer-revision", "7 abcdef\n"),
    ]);
    if (!read.ok) throw new Error("expected files");
    expect(importContext(read)).toBe(
      "Importing workspace.yaml, 1 project, which start from revision 7. What was saved after it stays unless the files change it too.",
    );
  });

  it("ignores hidden files other than .peer-revision", async () => {
    const read = await arrangeImport([
      entry("workspace.yaml", "currency: EUR\n"),
      entry("projects/._booking.yaml", "binary"),
      entry("projects/.hidden.yaml", "name: Hidden\n"),
    ]);
    expect(read).toMatchObject({ ok: true, files: { "workspace.yaml": "currency: EUR\n" } });
  });

  it("asks for the folder when there is no workspace.yaml", async () => {
    const message =
      "Those files have no workspace.yaml. Pick the folder that holds it, or a .zip from Export.";
    expect(await arrangeImport([entry("projects/booking.yaml", "name: Booking\n")])).toEqual({
      ok: false,
      problem: message,
    });
    expect(await arrangeImport([])).toEqual({ ok: false, problem: message });
  });

  it("refuses a file whose name is no id, which the Hub would drop and show as a removal", async () => {
    expect(
      await arrangeImport([
        entry("workspace.yaml", "currency: EUR\n"),
        entry("projects/Booking.yaml", "name: Booking\n"),
      ]),
    ).toEqual({
      ok: false,
      problem:
        "projects/Booking.yaml: the file name is the ID, so use lowercase letters, digits and hyphens.",
    });
  });

  it("refuses two files for one id", async () => {
    expect(
      await arrangeImport([
        entry("workspace.yaml", "currency: EUR\n"),
        entry("projects/booking.yaml", "name: Booking\n"),
        entry("projects/booking.yml", "name: Booking again\n"),
      ]),
    ).toEqual({ ok: false, problem: "There are two files for projects/booking.yaml." });
  });

  it("refuses more than settings can be, by size and by text", async () => {
    const big = 3 * 1024 * 1024;
    expect(
      await arrangeImport([
        entry("workspace.yaml", "currency: EUR\n"),
        entry("projects/big.yaml", "name: Big\n", big),
      ]),
    ).toEqual({ ok: false, problem: "Those files are larger than settings can be." });
    expect(
      await arrangeImport([
        entry("workspace.yaml", "currency: EUR\n", 0),
        entry("projects/big.yaml", "x".repeat(big), 0),
      ]),
    ).toEqual({ ok: false, problem: "Those files are larger than settings can be." });
  });

  describe("files picked one by one", () => {
    const loose = (files: Record<string, string>) =>
      arrangeImport(
        Object.entries(files).map(([path, text]) => entry(path, text)),
        { loose: true },
      );

    it("are told apart by what is in them, and named by their file names", async () => {
      const read = await loose({
        "workspace.yaml": "currency: EUR\n",
        "booking.yaml": "name: Booking\nmembers: ['*']\n",
        "postgres.yaml": "name: Postgres\nmcp:\n  command: npx\nrequires: []\n",
        "standard.yaml": "name: Standard\nmodels:\n  - id: claude-sonnet-5-5\n",
        "teams.yaml": "format: teams\nurl: ${secret:TEAMS}\nevents: [task.done]\n",
        ".peer-revision": "3 abc\n",
      });
      expect(read).toMatchObject({
        ok: true,
        base: 3,
        summary: "workspace.yaml, 1 project, 1 tool, 1 pool, 1 webhook",
      });
      if (!read.ok) return;
      expect(Object.keys(read.files)).toEqual([
        ".peer-revision",
        "capacity/standard.yaml",
        "projects/booking.yaml",
        "tools/postgres.yaml",
        "webhooks/teams.yaml",
        "workspace.yaml",
      ]);
    });

    it("are not guessed at when they came from a folder or an archive", async () => {
      const read = await arrangeImport([
        entry("acme/workspace.yaml", "currency: EUR\n"),
        entry("acme/docker-compose.yaml", "services: {}\n"),
      ]);
      expect(read).toMatchObject({ ok: true, files: { "workspace.yaml": "currency: EUR\n" } });
      if (read.ok) expect(Object.keys(read.files)).toEqual(["workspace.yaml"]);
    });

    it("refuse a name that is no id", async () => {
      expect(await loose({ "workspace.yaml": "", "My Project.yaml": "name: X\n" })).toEqual({
        ok: false,
        problem:
          "My Project.yaml: the file name is the ID, so use lowercase letters, digits and hyphens.",
      });
    });
  });
});

describe("what was picked", () => {
  const source = (path: string, text: string): ImportSource => ({
    ...entry(path, text),
    bytes: () => Promise.resolve(new TextEncoder().encode(text)),
  });

  it("is opened when it is one .zip", async () => {
    const archive = await buildArchive("acme", exported);
    const zip: ImportSource = {
      path: "acme-settings-r42.zip",
      size: archive.length,
      text: () => Promise.reject(new Error("a zip is not read as text")),
      bytes: () => Promise.resolve(archive),
    };
    expect(await readImport([zip])).toMatchObject({ ok: true, base: 42, files: exported });
  });

  it("is told apart from a folder's files when several are picked", async () => {
    const read = await readImport([
      source("acme/workspace.yaml", "currency: EUR\n"),
      source("acme/projects/booking.yaml", "name: Booking\n"),
    ]);
    expect(read).toMatchObject({ ok: true, summary: "workspace.yaml, 1 project" });
  });

  it("says a .zip that is not one cannot be opened", async () => {
    expect(await readImport([source("settings.zip", "not a zip")])).toEqual({
      ok: false,
      problem: "settings.zip could not be opened as a .zip.",
    });
  });

  it("says a file that cannot be read cannot be", async () => {
    const broken: ImportSource = {
      path: "workspace.yaml",
      size: 3,
      text: () => Promise.reject(new Error("permission denied")),
      bytes: () => Promise.reject(new Error("permission denied")),
    };
    expect(await readImport([broken])).toEqual({
      ok: false,
      problem: "The files could not be read: permission denied",
    });
  });

  it("ignores the litter an operating system leaves in an archive", async () => {
    const zip = new JSZip();
    zip.file("acme-settings/workspace.yaml", "currency: EUR\n");
    zip.file("__MACOSX/acme-settings/._workspace.yaml", "x");
    zip.file("acme-settings/.DS_Store", "x");
    const entries = await readArchive(await zip.generateAsync({ type: "uint8array" }));
    expect(entries.map((file) => file.path)).toEqual(["acme-settings/workspace.yaml"]);
  });
});

describe("small pieces", () => {
  it("reads the revision a .peer-revision names", () => {
    expect(revisionOf("42 3f2a9c1e5b7d\n")).toBe(42);
    expect(revisionOf("7")).toBe(7);
    expect(revisionOf("abc")).toBeUndefined();
    expect(revisionOf("")).toBeUndefined();
    expect(revisionOf(undefined)).toBeUndefined();
  });

  it.each([
    ["name: Postgres\nmcp:\n  command: npx\n", "tools"],
    ["name: Standard\nmodels: []\n", "capacity"],
    ["format: teams\nurl: x\n", "webhooks"],
    ["events: [a]\n", "webhooks"],
    ["name: Booking\nmembers: ['*']\ntools: [mcp]\n", "projects"],
    ["", "projects"],
  ])("tells %j is in %s", (text, folder) => {
    expect(sniffFolder(text)).toBe(folder);
  });

  it("sums up what the files hold", () => {
    expect(importSummary({ "workspace.yaml": "" })).toBe("workspace.yaml");
    expect(
      importSummary({
        "workspace.yaml": "",
        "projects/a.yaml": "",
        "projects/b.yaml": "",
        "webhooks/w.yaml": "",
      }),
    ).toBe("workspace.yaml, 2 projects, 1 webhook");
  });
});
