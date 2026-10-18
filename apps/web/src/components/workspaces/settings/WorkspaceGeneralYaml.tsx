/**
 * "Settings as YAML" (design artboard 14): Export saves the workspace's settings as one .zip of the
 * folder `peerhub workspace apply` reads; Import takes such a folder, a .zip or loose files, and
 * opens the review of what they would change before anything is saved. Work's empty state links
 * here (`#yaml`), so the card is a settings search target.
 */
import type { EnvironmentId, PeerWorkspaceState } from "@t3tools/contracts";
import { useRef, useState, type ChangeEvent } from "react";

import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsSearchTarget } from "../../settings/settingsLayout";
import { Button } from "../../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import { failureMessage } from "../WorkspaceAccess";
import { archiveName, buildArchive, importContext, readImport } from "./workspaceGeneralYaml.logic";
import type { ImportSource } from "./workspaceGeneralYaml.logic";
import { useReviewChanges } from "./useReviewChanges";
import type { SettingsView } from "./useSettingsView";
import { withFinally } from "~/lib/withFinally";

/** Browsers take `webkitdirectory` (the folder's files, each with its path) though React's types do not know it. */
const DIRECTORY_INPUT = { webkitdirectory: "", directory: "" } as Readonly<Record<string, string>>;

const sourcesOf = (files: ReadonlyArray<File>): ReadonlyArray<ImportSource> =>
  files.map((file) => ({
    path: file.webkitRelativePath === "" ? file.name : file.webkitRelativePath,
    size: file.size,
    text: () => file.text(),
    bytes: async () => new Uint8Array(await file.arrayBuffer()),
  }));

/** Hands the person a file: the browser (or the desktop app) saves it where downloads go. */
function saveFile(name: string, bytes: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  // Revoking at once can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function YamlCard({
  environmentId,
  workspace,
  view,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
  readonly view: SettingsView;
}) {
  const exportYaml = useAtomCommand(serverEnvironment.peerSettings.exportYaml, {
    reportFailure: false,
  });
  const sync = useAtomCommand(serverEnvironment.peerHubSync, { reportFailure: false });
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // What an import saved may change projects, tools and pools anywhere: read the settings and the
  // manifest again.
  const review = useReviewChanges({
    scope: workspace.name,
    onSaved: () => {
      view.refresh();
      void sync({ environmentId, input: {} });
    },
  });

  /** What was picked is read at once, and the input is cleared so the same files can be picked again. */
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    void doImport(files);
  };

  const doExport = async () => {
    setBusy("export");
    setError(null);
    setSaved(null);
    return withFinally(
      async () => {
        try {
          const result = await exportYaml({ environmentId, input: { workspace: workspace.slug } });
          const failure = failureMessage(result);
          if (failure !== null) return setError(failure);
          if (result._tag !== "Success") return;
          const name = archiveName(workspace.slug, result.value.revision.seq);
          saveFile(name, await buildArchive(workspace.slug, result.value.files), "application/zip");
          setSaved(name);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "The files could not be saved.");
        }
      },
      () => {
        setBusy(null);
      },
    );
  };

  const doImport = async (files: ReadonlyArray<File>) => {
    if (files.length === 0) return;
    setBusy("import");
    setError(null);
    setSaved(null);
    return withFinally(
      async () => {
        const read = await readImport(sourcesOf(files));
        if (!read.ok) return setError(read.problem);
        review.open(
          {
            kind: "import",
            workspace: workspace.slug,
            files: read.files,
            ...(read.base === undefined ? {} : { base: read.base }),
          },
          { scope: workspace.name, context: importContext(read) },
        );
      },
      () => {
        setBusy(null);
      },
    );
  };

  return (
    <SettingsSearchTarget id="yaml" className="outline-none">
      <section
        aria-labelledby="yaml-heading"
        className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3.5"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
          <div className="flex min-w-60 flex-1 flex-col gap-0.5">
            <h2 id="yaml-heading" className="text-sm font-semibold text-foreground">
              Settings as YAML
            </h2>
            <p className="text-sm text-muted-foreground">
              This Hub keeps {workspace.name}’s settings. Import shows every change first and never
              overwrites edits made after your file.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void doExport()}
            >
              {busy === "export" ? "Exporting…" : "Export"}
            </Button>
            <Menu>
              <MenuTrigger render={<Button size="sm" variant="outline" disabled={busy !== null} />}>
                Import…
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem onClick={() => folderInput.current?.click()}>A folder…</MenuItem>
                <MenuItem onClick={() => filesInput.current?.click()}>Files or a .zip…</MenuItem>
              </MenuPopup>
            </Menu>
          </div>
        </div>
        <input
          ref={folderInput}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a folder of settings to import"
          {...DIRECTORY_INPUT}
          onChange={pick}
        />
        <input
          ref={filesInput}
          type="file"
          multiple
          accept=".yaml,.yml,.zip,.peer-revision"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose settings files or a .zip to import"
          onChange={pick}
        />
        {saved === null ? null : (
          <p role="status" className="text-xs text-muted-foreground">
            Saved {saved}. Unzipped, it is the folder{" "}
            <code className="font-mono">peerhub workspace apply</code> reads.
          </p>
        )}
        {error === null ? null : (
          <p role="alert" className="text-xs text-destructive-foreground">
            {error}
          </p>
        )}
      </section>
      {review.dialog}
    </SettingsSearchTarget>
  );
}
