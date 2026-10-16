/**
 * The smaller parts of the workspace's General page (design artboard 14): the name, the company
 * knowledge fields over the page's draft, and the rows kept from the Workspaces page (its
 * configuration, its folder and Leave). The domains and the YAML card are `WorkspaceGeneralDomains`
 * and `WorkspaceGeneralYaml`.
 */
import type { EnvironmentId, PeerHubStatus, PeerWorkspaceState } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";

import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsRow } from "../../settings/settingsLayout";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { PeerStackedField } from "../PeerDialog";
import { reportFailure } from "../workFeedback";
import { HostedWorkspaceSettings } from "./PluginSlots";
import {
  branchTextProblem,
  checkName,
  configurationText,
  repositoryTextProblem,
  storeTextProblem,
  NAME_MAX,
} from "./workspaceGeneral.logic";

/**
 * What a text field shows while the person types in it: what they typed, even where the draft does
 * not take it (an address that is not one). Leaving the field shows the draft's value again.
 */
function useTyped(committed: string) {
  const [typed, setTyped] = useState<string | null>(null);
  return { shown: typed ?? committed, typed, type: setTyped, leave: () => setTyped(null) };
}

const problemClass = "text-xs text-destructive-foreground";

/**
 * The workspace's name. Admins change it: a name that differs offers Save and Cancel (Enter saves),
 * and saving renames the workspace on the Hub, which the page's status follows from the next sync.
 */
export function NameField({
  name,
  editable,
  note,
  onSave,
}: {
  readonly name: string;
  readonly editable: boolean;
  /** Under the field: who changes the name, for someone who does not. */
  readonly note?: string | undefined;
  /** Renames the workspace; resolves with why it could not, or null once it did. */
  readonly onSave: (name: string) => Promise<string | null>;
}) {
  const id = useId();
  const [typed, setTyped] = useState<string | null>(null);
  // The name as saved stands in for the workspace's until the status has caught up with the rename.
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = saved !== null && saved !== name ? saved : name;
  const shown = typed ?? current;
  const check = checkName(shown, current);
  return (
    <form
      className="flex max-w-xl flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!check.ok || busy) return;
        setBusy(true);
        setError(null);
        void onSave(check.name)
          .then((problem) => {
            if (problem === null) {
              setSaved(check.name);
              setTyped(null);
            } else {
              setError(problem);
            }
          })
          .finally(() => setBusy(false));
      }}
    >
      <PeerStackedField label="Workspace name" htmlFor={id}>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={id}
            className="max-w-sm min-w-48 flex-1"
            autoComplete="off"
            maxLength={NAME_MAX}
            value={shown}
            disabled={!editable || busy}
            aria-invalid={(!check.ok && check.problem !== null) || undefined}
            onChange={(event) => setTyped(event.target.value)}
          />
          {typed !== null && typed.trim() !== current.trim() ? (
            <>
              <Button type="submit" size="sm" disabled={!check.ok || busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setTyped(null);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </>
          ) : null}
        </div>
      </PeerStackedField>
      {note === undefined ? null : <p className="text-xs text-muted-foreground">{note}</p>}
      {!check.ok && check.problem !== null ? (
        <p role="alert" className={problemClass}>
          {check.problem}
        </p>
      ) : null}
      {error === null ? null : (
        <p role="alert" className={problemClass}>
          Could not rename the workspace: {error}
        </p>
      )}
    </form>
  );
}

/** The knowledge store's three fields as the page shows them. */
export interface KnowledgeFieldValues {
  readonly repository: string;
  readonly branch: string;
  readonly store: string;
}

/**
 * Repository, branch and folder of the company knowledge store. A value goes into the draft as soon
 * as it can be one; one that cannot says why and is not taken. Branch and folder need a repository;
 * leaving the repository empty takes the store away (no company knowledge).
 */
export function KnowledgeFields({
  values,
  editable,
  onRepository,
  onBranch,
  onStore,
  onRemove,
}: {
  readonly values: KnowledgeFieldValues;
  readonly editable: boolean;
  readonly onRepository: (repository: string) => void;
  readonly onBranch: (branch: string) => void;
  readonly onStore: (store: string) => void;
  readonly onRemove: () => void;
}) {
  const ids = [useId(), useId(), useId()] as const;
  const repository = useTyped(values.repository);
  const branch = useTyped(values.branch);
  const store = useTyped(values.store);
  const hasStore = values.repository !== "";
  // What is saved was good enough for the Hub: only what is being typed can be wrong.
  const repositoryProblem =
    repository.typed === null ? null : repositoryTextProblem(repository.typed);
  const branchProblem = branch.typed === null ? null : branchTextProblem(branch.typed);
  const storeProblem = store.typed === null ? null : storeTextProblem(store.typed);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_7rem]">
        <PeerStackedField label="Repository" htmlFor={ids[0]}>
          <Input
            id={ids[0]}
            font="mono"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://github.com/acme/knowledge"
            value={repository.shown}
            disabled={!editable}
            aria-invalid={repositoryProblem !== null || undefined}
            onChange={(event) => {
              const text = event.target.value;
              repository.type(text);
              if (text.trim() !== "" && repositoryTextProblem(text) === null) onRepository(text);
            }}
            onBlur={() => {
              if (repository.shown.trim() === "" && hasStore) onRemove();
              repository.leave();
            }}
          />
        </PeerStackedField>
        <PeerStackedField label="Branch" htmlFor={ids[1]}>
          <Input
            id={ids[1]}
            font="mono"
            autoComplete="off"
            spellCheck={false}
            placeholder="main"
            value={branch.shown}
            disabled={!editable || !hasStore}
            aria-invalid={branchProblem !== null || undefined}
            onChange={(event) => {
              const text = event.target.value;
              branch.type(text);
              if (text.trim() !== "" && branchTextProblem(text) === null) onBranch(text);
            }}
            onBlur={branch.leave}
          />
        </PeerStackedField>
        <PeerStackedField label="Folder" htmlFor={ids[2]}>
          <Input
            id={ids[2]}
            font="mono"
            autoComplete="off"
            spellCheck={false}
            placeholder=".ai"
            value={store.shown}
            disabled={!editable || !hasStore}
            aria-invalid={storeProblem !== null || undefined}
            onChange={(event) => {
              const text = event.target.value;
              store.type(text);
              if (text.trim() !== "" && storeTextProblem(text) === null) onStore(text);
            }}
            onBlur={store.leave}
          />
        </PeerStackedField>
      </div>
      {[repositoryProblem, branchProblem, storeProblem].map((problem) =>
        problem === null ? null : (
          <p key={problem} role="alert" className={problemClass}>
            {problem}
          </p>
        ),
      )}
    </div>
  );
}

/**
 * The rows the shell moved here from the Workspaces page: what configuration is applied, where the
 * workspace's projects live on this computer, why the last refresh failed (if it did), the rows
 * plugins host on this page, and Leave.
 */
export function WorkspaceRows({
  environmentId,
  status,
  workspace,
  revision,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: PeerWorkspaceState;
  /** The settings revision, once read. */
  readonly revision: number | null;
}) {
  const leave = useAtomCommand(serverEnvironment.peerHubLeaveWorkspace, { reportFailure: false });
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <SettingsGroup>
      <SettingsRow
        title="Configuration"
        description={configurationText(revision, workspace.revision)}
      />
      <SettingsRow
        title="Folder"
        description={`Projects are cloned under ${status.workspaceRoot}/${workspace.slug}`}
      />
      {workspace.error ? (
        <SettingsRow title="Could not refresh" description={workspace.error} />
      ) : null}
      <HostedWorkspaceSettings
        host="general"
        environmentId={environmentId}
        status={status}
        workspace={workspace}
      />
      <SettingsRow
        title={`Leave ${workspace.name}`}
        description="Take yourself out of this workspace."
        control={
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void leave({ environmentId, input: { workspace: workspace.slug } })
                .then((result) => {
                  reportFailure(`Could not leave ${workspace.name}`, result);
                  // The workspace is gone from the list: open what is left.
                  if (result._tag === "Success") void navigate({ to: "/settings/peer" });
                })
                .finally(() => setBusy(false));
            }}
          >
            Leave
          </Button>
        }
      />
    </SettingsGroup>
  );
}
