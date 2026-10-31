import { GitBranchIcon, XIcon } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";

import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { PeerCallout } from "../PeerDialog";
import {
  PR_LABEL,
  branchProblem,
  isGitHubUrl,
  newRepositoryProblems,
  repositoryIdFromUrl,
  shortUrl,
  uniqueRepositoryId,
  type CloneView,
  type JjView,
  type RepositoryEntry,
} from "./projectRepositories.logic";

/** One repository as the page lists it. */
export interface RepositoryRowModel extends RepositoryEntry {
  /** The first repository holds the project's knowledge. */
  readonly knowledge: boolean;
  /** The draft adds it. */
  readonly notSaved: boolean;
  readonly pr: "verified" | "reported";
  readonly clone: CloneView;
  readonly jj: JjView;
}

function Problem({ children }: { readonly children: ReactNode }) {
  return (
    <p role="alert" className="text-xs text-destructive-foreground">
      {children}
    </p>
  );
}

/** A branch with its mark, as the chip shows it. */
function BranchLabel({ branch }: { readonly branch: string }) {
  return (
    <>
      <GitBranchIcon aria-hidden />
      <span className="font-mono">{branch}</span>
    </>
  );
}

/**
 * The branch a repository is cloned on: a chip that becomes a field when it is clicked, finishing
 * with Enter or by leaving it, and leaving the branch as it was with Escape or a name git would not
 * take. Readers see the chip alone.
 */
function BranchChip({
  id,
  branch,
  editable,
  onChange,
}: {
  readonly id: string;
  readonly branch: string;
  readonly editable: boolean;
  readonly onChange: (branch: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(branch);
  // Enter, leaving the field and Escape each end an edit once, whatever else the field reports.
  const ended = useRef(false);
  const problem = branchProblem(value);
  const end = (keep: boolean) => {
    if (ended.current) return;
    ended.current = true;
    if (keep && value.trim() !== branch && problem === null) onChange(value.trim());
    setEditing(false);
  };
  if (!editable) {
    return (
      <Badge variant="outline" size="lg">
        <BranchLabel branch={branch} />
      </Badge>
    );
  }
  if (!editing) {
    return (
      <Button
        size="xs"
        variant="outline"
        aria-label={`Branch of ${id}: ${branch}. Change it`}
        onClick={() => {
          ended.current = false;
          setValue(branch);
          setEditing(true);
        }}
      >
        <BranchLabel branch={branch} />
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Input
        nativeInput
        autoFocus
        className="w-40"
        size="compact"
        font="mono"
        aria-label={`Branch of ${id}`}
        aria-invalid={problem !== null}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => end(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && problem === null) end(true);
          else if (event.key === "Escape") end(false);
        }}
      />
      {problem === null ? null : <Problem>{problem}</Problem>}
    </div>
  );
}

/** What a row says of the clone on this computer: where it is, or the action that puts it here. */
function CloneCell({
  clone,
  busy,
  onClone,
}: {
  readonly clone: CloneView;
  readonly busy: boolean;
  readonly onClone: () => void;
}) {
  switch (clone.kind) {
    case "cloned":
      return <span className="text-xs text-muted-foreground">Cloned here</span>;
    case "cloning":
      return <span className="text-xs text-muted-foreground">Cloning…</span>;
    case "open":
      return (
        <Button size="xs" variant="outline" disabled={busy} onClick={onClone}>
          {busy ? "Opening…" : "Open"}
        </Button>
      );
    case "clone":
      return (
        <Button size="xs" variant="outline" disabled={busy} onClick={onClone}>
          {busy ? "Cloning…" : "Clone & open"}
        </Button>
      );
    case "unsupported":
      return <span className="text-xs text-muted-foreground">Not supported here</span>;
    case "unsaved":
      return null;
  }
}

function RepositoryRow({
  row,
  editable,
  busy,
  onBranch,
  onRemove,
  onClone,
  onSwitchToJj,
}: {
  readonly row: RepositoryRowModel;
  readonly editable: boolean;
  readonly busy: boolean;
  readonly onBranch: (branch: string) => void;
  readonly onRemove: () => void;
  readonly onClone: () => void;
  readonly onSwitchToJj: () => void;
}) {
  const failure =
    row.clone.kind === "clone"
      ? row.clone.error
      : row.clone.kind === "unsupported"
        ? row.clone.reason
        : undefined;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3">
      <div className="flex min-w-0 flex-1 basis-72 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-medium text-foreground">{row.id}</span>
          {row.knowledge ? <Badge variant="knowledge">Project knowledge</Badge> : null}
          {row.notSaved ? <Badge variant="info">Not saved</Badge> : null}
          {row.jj.kind === "on" ? <Badge variant="info">Jujutsu</Badge> : null}
        </span>
        <span className="truncate text-xs text-muted-foreground">{shortUrl(row.url)}</span>
        {failure === undefined ? null : (
          <span className="text-xs text-destructive-foreground">{failure}</span>
        )}
        {row.jj.kind === "offer" && row.jj.blocked !== null ? (
          <span className="text-xs text-muted-foreground">{row.jj.blocked}</span>
        ) : null}
      </div>
      {row.jj.kind === "offer" ? (
        <Button
          size="xs"
          variant="outline"
          disabled={busy || row.jj.blocked !== null}
          title="Adds Jujutsu beside Git. .git, the remotes and unfinished work stay."
          onClick={onSwitchToJj}
        >
          Switch to Jujutsu
        </Button>
      ) : null}
      <BranchChip id={row.id} branch={row.branch} editable={editable} onChange={onBranch} />
      <Badge variant={row.pr === "verified" ? "success" : "warning"} size="lg">
        {PR_LABEL[row.pr]}
      </Badge>
      <span className="flex w-28 shrink-0 items-center">
        <CloneCell clone={row.clone} busy={busy} onClone={onClone} />
      </span>
      {editable ? (
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label={`Remove ${row.id}`}
          onClick={onRemove}
        >
          <XIcon aria-hidden />
        </Button>
      ) : null}
    </li>
  );
}

/** The project's repositories, one row each, with the clone state on this computer. */
export function RepositoryList({
  rows,
  editable,
  busy,
  onBranch,
  onRemove,
  onClone,
  onSwitchToJj,
}: {
  readonly rows: ReadonlyArray<RepositoryRowModel>;
  readonly editable: boolean;
  /** A clone is under way: the actions that start one wait for it. */
  readonly busy: boolean;
  readonly onBranch: (id: string, branch: string) => void;
  readonly onRemove: (id: string) => void;
  readonly onClone: () => void;
  readonly onSwitchToJj: (id: string) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No repositories yet.</p>;
  }
  return (
    <ul
      aria-label="Repositories"
      className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card"
    >
      {rows.map((row) => (
        <RepositoryRow
          key={row.id}
          row={row}
          editable={editable}
          busy={busy}
          onBranch={(branch) => onBranch(row.id, branch)}
          onRemove={() => onRemove(row.id)}
          onClone={onClone}
          onSwitchToJj={() => onSwitchToJj(row.id)}
        />
      ))}
    </ul>
  );
}

/**
 * Adds a repository by its Git URL and branch. Its id comes from the URL and is made unique in the
 * project; an address on another host than github.com is allowed, with a note that its pull
 * requests are only as the agent reports them.
 */
export function AddRepositoryForm({
  projectName,
  takenIds,
  onAdd,
  onCancel,
}: {
  readonly projectName: string;
  readonly takenIds: ReadonlyArray<string>;
  readonly onAdd: (entry: RepositoryEntry) => void;
  readonly onCancel: () => void;
}) {
  const formId = useId();
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const problems = newRepositoryProblems({ url, branch });
  const id = uniqueRepositoryId(repositoryIdFromUrl(url), takenIds);
  const elsewhere = url.trim() !== "" && problems.url === null && !isGitHubUrl(url.trim());
  return (
    <form
      aria-labelledby={`${formId}-title`}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (problems.ready) onAdd({ id, url: url.trim(), branch: branch.trim() });
      }}
    >
      <h3 id={`${formId}-title`} className="text-sm font-semibold text-foreground">
        Add a repository
      </h3>
      <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_9.5rem]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${formId}-url`} className="text-sm font-medium text-foreground">
            Git URL
          </label>
          <Input
            nativeInput
            autoFocus
            id={`${formId}-url`}
            font="mono"
            placeholder="https://github.com/acme/app.git"
            aria-invalid={problems.url !== null}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${formId}-branch`} className="text-sm font-medium text-foreground">
            Branch
          </label>
          <Input
            nativeInput
            id={`${formId}-branch`}
            font="mono"
            aria-invalid={problems.branch !== null}
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
          />
        </div>
      </div>
      {problems.url === null ? null : <Problem>{problems.url}</Problem>}
      {problems.branch === null ? null : <Problem>{problems.branch}</Problem>}
      <p className="text-xs text-muted-foreground">
        ID <span className="font-mono text-foreground">{id}</span> · unique in {projectName}
      </p>
      {elsewhere ? (
        <PeerCallout tone="needs">
          This isn’t on github.com, so Peer can’t confirm its PRs were merged. Tasks here finish
          with the PR the agent reports.
        </PeerCallout>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={!problems.ready}>
          Add
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
