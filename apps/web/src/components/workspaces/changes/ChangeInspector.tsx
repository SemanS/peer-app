import type { ChangeInspectorModel } from "@t3tools/client-runtime/peer/changes";
import type { ChangeRow, LandedChange } from "@t3tools/contracts";
import { LockIcon } from "lucide-react";

import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { PeerSectionLabel } from "../PeerPageHeader";
import type { ChangeSlotProps, PeerWebPlugin, SelectedChange } from "../slots.types";
import { ChangeId, type LandedRowModel } from "./ChangeGraph";
import { buildsOnLine, olderBaseLine, rewriteLine, versionsLine, whereLine } from "./changes.logic";

const STATE_VARIANT = { info: "info", warn: "warning", plain: "outline" } as const;

function Section({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-4">
      <PeerSectionLabel>{label}</PeerSectionLabel>
      {children}
    </section>
  );
}

/**
 * The selected change: its state and where it lives, what other plugins say about it (the
 * `changeSections` slot, rendered as each plugin likes), its versions, who may rewrite it and its
 * files. A landed change has none of the first, only what trunk keeps of it.
 */
export function ChangeInspector({
  model,
  idParts,
  row,
  landed,
  mine,
  taskId,
  plugins,
  slot,
  clock,
  canReview,
  onReview,
}: {
  readonly model: ChangeInspectorModel | undefined;
  readonly idParts: { readonly pre: string; readonly rest: string } | undefined;
  readonly row: ChangeRow | undefined;
  readonly landed: { readonly row: LandedRowModel; readonly change: LandedChange } | undefined;
  readonly mine: boolean;
  /** The task the change is on, as the work tree knows it; undefined for a change on none. */
  readonly taskId: string | undefined;
  readonly plugins: ReadonlyArray<PeerWebPlugin>;
  readonly slot: Omit<ChangeSlotProps, "change">;
  readonly clock: (at: string) => string;
  readonly canReview: boolean;
  readonly onReview: () => void;
}) {
  if (landed !== undefined) {
    return (
      <aside aria-label="Selected change" className="flex flex-col gap-4">
        <header className="flex flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <ChangeId {...landed.row.id} />
            <Badge variant="outline" size="sm">
              Landed
            </Badge>
          </span>
          <h2 className="text-base font-semibold text-foreground">{landed.change.subject}</h2>
          <p className="text-xs text-muted-foreground">
            The newest landed change on {landed.change.bookmark}. Every change in flight starts here
            or above.
          </p>
        </header>
        <Section label="Versions">
          <p className="text-sm text-muted-foreground">
            Landed changes keep their history in the operation log.
          </p>
        </Section>
        <Section label="Who can rewrite it">
          <p className="flex gap-2 text-sm text-foreground">
            <LockIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            {rewriteLine({ row: undefined, mine: false })}
          </p>
        </Section>
        <Files paths={landed.change.paths ?? []} />
      </aside>
    );
  }
  if (model === undefined || row === undefined || idParts === undefined) {
    return (
      <aside aria-label="Selected change">
        <p className="text-sm text-muted-foreground">Select a change to see where it lives.</p>
      </aside>
    );
  }
  const change: SelectedChange = {
    changeId: row.changeId,
    taskId,
    bookmarks: row.bookmarks,
    mine,
  };
  return (
    <aside aria-label="Selected change" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <ChangeId {...idParts} />
          {model.key === undefined ? null : (
            <span className="rounded-sm bg-muted px-1 font-mono text-2xs text-muted-foreground">
              {model.key}
            </span>
          )}
          <Badge variant={STATE_VARIANT[model.state.tone]} size="sm">
            {model.state.label}
          </Badge>
        </span>
        <h2 className="text-base font-semibold text-foreground">{model.title}</h2>
        <p className="text-xs text-muted-foreground">
          {whereLine(model.who, model.environments)}
          {model.bookmark === undefined ? null : ` · ${model.bookmark}`}
        </p>
      </header>

      {plugins.map(({ id, changeSections: Extra }) =>
        Extra === undefined ? null : <Extra key={id} {...slot} change={change} />,
      )}

      {model.buildsOn.length === 0 ? null : (
        <Section label="Builds on">
          <p className="text-sm text-foreground">{buildsOnLine(model)}</p>
          {model.olderBases.map((base) => (
            <p key={base.changeId} className="text-sm text-muted-foreground">
              {olderBaseLine(base)}
            </p>
          ))}
        </Section>
      )}

      {model.twoVersions ? (
        <Section label="Two versions at once">
          <p className="text-sm text-foreground">
            jj keeps both, so nothing is lost:{" "}
            {model.versionIds.map((id, index) => (
              <span key={id}>
                {index === 0 ? null : " and "}
                <code className="font-mono text-xs">{id}</code>
              </span>
            ))}
            .
          </p>
        </Section>
      ) : null}

      <Section label="Versions">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-sm text-foreground">{versionsLine(model.versions, clock)}</span>
          {canReview ? (
            <Button size="xs" variant="outline" onClick={onReview}>
              {model.versions.sinceMark > 0 ? "Review what moved" : "Open review"}
            </Button>
          ) : null}
        </div>
      </Section>

      <Section label="Who can rewrite it">
        <p className="flex gap-2 text-sm text-foreground">
          <LockIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          {rewriteLine({ row, mine })}
        </p>
      </Section>

      <Files paths={model.files} />
    </aside>
  );
}

function Files({ paths }: { readonly paths: ReadonlyArray<string> }) {
  return (
    <Section label="Files">
      {paths.length === 0 ? (
        <p className="text-sm text-muted-foreground">No file changed yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {paths.map((path) => (
            <li key={path} className="font-mono text-xs break-all text-foreground">
              {path}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
