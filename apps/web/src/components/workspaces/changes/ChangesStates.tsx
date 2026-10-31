import { useAtomValue } from "@effect/atom-react";
import type { ChangesPageModel, GitTeammateRow } from "@t3tools/client-runtime/peer/changes";
import type { EnvironmentId } from "@t3tools/contracts";
import { useParams } from "@tanstack/react-router";
import { GitBranchIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { PeerCard } from "../PeerPageHeader";
import { useSwitchToJujutsu } from "../useOpenWorkspaceProject";
import { useWorkData } from "../useWorkData";
import { failureMessage } from "../WorkspaceAccess";

function Copy({ command }: { readonly command: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ timeout: 1_500, target: command });
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 font-mono text-xs break-all text-foreground select-all">
        {command}
      </code>
      <Button
        size="xs"
        variant="outline"
        aria-label={`Copy ${command}`}
        onClick={() => copyToClipboard(command, undefined)}
      >
        {isCopied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** A card of the honest states: what is wrong in a word, why, and the one next step. */
export function StateCard({
  title,
  word,
  tone = "outline",
  busy,
  children,
}: {
  readonly title: string;
  readonly word?: string | undefined;
  readonly tone?: "outline" | "warning" | "error" | "info";
  readonly busy?: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <PeerCard className="w-full max-w-2xl">
      <div aria-busy={busy === true ? true : undefined} className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {word === undefined ? null : (
            <Badge variant={tone} size="sm">
              {word}
            </Badge>
          )}
        </div>
        {children}
      </div>
    </PeerCard>
  );
}

/** Teammates on Git, by branch: no change ids or versions to show, and nothing fails. */
export function GitByBranch({ rows }: { readonly rows: ReadonlyArray<GitTeammateRow> }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label="On Git" className="flex flex-col gap-2 border-t border-border pt-3">
      <h2 className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
        On Git, by branch
      </h2>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={`${row.email}:${row.branch}`} className="flex flex-wrap items-center gap-2">
            <GitBranchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm text-foreground">{row.who}</span>
            {row.key === undefined ? null : (
              <span className="rounded-sm bg-muted px-1 font-mono text-2xs text-muted-foreground">
                {row.key}
              </span>
            )}
            <code className="font-mono text-xs text-foreground">{row.branch}</code>
            <span className="text-xs text-muted-foreground">{row.note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What the page says when it cannot draw the graph: jj missing, too old or not colocated (the cause
 * and the fix, and nothing written), loading, a jj failure that Peer retries at the agent's next
 * step, and nothing in flight. The older Hub is the page every inactive plugin shows, but the
 * model's own words stay here for a status that has not caught up.
 */
export function ChangesNote({
  page,
  onStart,
}: {
  readonly page: Exclude<ChangesPageModel, { readonly kind: "ready" }>;
  readonly onStart: () => void;
}) {
  switch (page.kind) {
    case "jj":
      return (
        <StateCard
          title={page.note.title}
          word={page.note.word}
          tone={page.note.word === "Problem" ? "warning" : "outline"}
        >
          <p className="text-sm text-muted-foreground">{page.note.body}</p>
          <Copy command={page.note.fix} />
          {page.note.kind === "notColocated" ? <MakeColocated /> : null}
        </StateCard>
      );
    case "hubOlder":
      return (
        <StateCard title={page.title} word="Older Hub">
          <p className="text-sm text-muted-foreground">{page.body}</p>
        </StateCard>
      );
    case "loading":
      return (
        <StateCard title={page.title} word="Loading" busy>
          <p role="status" className="text-sm text-muted-foreground">
            {page.body}
          </p>
        </StateCard>
      );
    case "failed":
      return (
        <StateCard title={page.title} word="Error" tone="error">
          <code className="rounded-md border border-border bg-muted/50 px-2.5 py-1.5 font-mono text-xs break-words text-foreground">
            {page.message}
          </code>
          <p className="text-sm text-muted-foreground">{page.footnote}</p>
        </StateCard>
      );
    case "empty":
      return (
        <div className="flex w-full flex-col gap-4">
          <StateCard title={page.title} word="Empty">
            <p className="text-sm text-muted-foreground">{page.body}</p>
            <div>
              <Button size="sm" variant="outline" onClick={onStart}>
                {page.action}
              </Button>
            </div>
          </StateCard>
          <GitByBranch rows={page.byBranch} />
        </div>
      );
  }
}

/** Runs the note's fix on this computer, for the project on the page. */
function MakeColocated() {
  const { environmentId } = useWorkData();
  const { workspace, project } = useParams({ strict: false });
  if (environmentId === null || workspace === undefined || project === undefined) return null;
  return (
    <MakeColocatedButton environmentId={environmentId} workspace={workspace} project={project} />
  );
}

function MakeColocatedButton({
  environmentId,
  workspace,
  project,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
}) {
  const { allowed, busy, switchTo } = useSwitchToJujutsu(environmentId);
  if (!allowed) return null;
  return (
    <div>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => void switchTo({ workspace, projectId: project })}
      >
        {busy ? "Making it colocated…" : "Make it colocated"}
      </Button>
    </div>
  );
}

/** A change that holds two versions at once: both, and what to do about it. */
export function TwoVersionsCard({
  title,
  versionIds,
  onShow,
}: {
  readonly title: string;
  readonly versionIds: ReadonlyArray<string>;
  readonly onShow: () => void;
}) {
  const [first, second] = versionIds;
  // `mspqrmyv/0` and `mspqrmyv/1` are versions of the change `mspqrmyv`.
  const change = first?.split("/")[0];
  const { environmentId } = useWorkData();
  const { workspace, project } = useParams({ strict: false });
  const converge = useAtomCommand(serverEnvironment.peerJujutsuConverge, { reportFailure: false });
  const allowed = useAtomValue(serverEnvironment.peerJujutsuConverge.permissionAtom(environmentId));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // A promise chain rather than try/finally: the React Compiler does not compile `try` here.
  const merge = () => {
    if (environmentId === null || workspace === undefined || project === undefined) return;
    if (change === undefined) return;
    setBusy(true);
    void converge({ environmentId, input: { workspace, project, change } })
      .then((result) =>
        setMessage(
          failureMessage(result) ??
            (result._tag === "Success" && result.value.resolved
              ? "Merged into one version. Undo it from Operations like any step."
              : "jj needs a person's choice here, so both versions stay."),
        ),
      )
      .finally(() => setBusy(false));
  };
  return (
    <StateCard title={title} word="Two versions" tone="warning">
      <p className="text-sm text-muted-foreground">
        Two steps rewrote it at the same time, so jj keeps both, as{" "}
        <code className="font-mono text-xs">{first}</code> and{" "}
        <code className="font-mono text-xs">{second}</code>. Nothing is lost. jj converge makes one
        version of them; its result can be undone like any step.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !allowed || environmentId === null || change === undefined}
          onClick={merge}
        >
          {busy ? "Merging…" : "Converge"}
        </Button>
        <Button size="sm" variant="outline" onClick={onShow}>
          Show both versions
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Converge runs on the computer that holds the change.
      </p>
      {message === null ? null : (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      )}
    </StateCard>
  );
}
