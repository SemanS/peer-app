import type {
  ChangeBadge,
  ChangeGraph as ChangeGraphLayout,
  ChangeRowModel,
  ScopedRow,
} from "@t3tools/client-runtime/peer/changes";
import type { LandedChange } from "@t3tools/contracts";
import { LinkIcon, XIcon } from "lucide-react";

import { cn } from "../../../lib/utils";
import { Badge } from "../../ui/badge";
import { SHAPE_WORDS, ShapeAt } from "./ChangeShape";
import { GRAPH, rowDrawing } from "./changes.logic";

const BADGE_VARIANT = { info: "info", warn: "warning", plain: "outline" } as const;

function BadgeMark({ id }: { readonly id: ChangeBadge["id"] }) {
  switch (id) {
    case "working":
      return <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />;
    case "review":
      return <span aria-hidden className="size-1.5 shrink-0 rounded-full border border-current" />;
    case "conflict":
      return <XIcon aria-hidden className="size-3 shrink-0" strokeWidth={2.5} />;
    case "buildsOn":
      return <LinkIcon aria-hidden className="size-3 shrink-0" />;
    default:
      return null;
  }
}

/** A row's identity: the shortest unique prefix of the change id is the part to type. */
export function ChangeId({ pre, rest }: { readonly pre: string; readonly rest: string }) {
  return (
    <span className="shrink-0 font-mono text-xs text-muted-foreground">
      <b className="font-semibold text-foreground">{pre}</b>
      {rest}
    </span>
  );
}

export interface LandedRowModel {
  readonly landed: LandedChange;
  readonly id: { readonly pre: string; readonly rest: string };
  readonly key: string;
  readonly title: string;
  readonly who: string;
}

function RowLines({ row, lanes }: { readonly row: ScopedRow["row"]; readonly lanes: number }) {
  const drawing = rowDrawing(row, lanes);
  return (
    <svg
      aria-hidden
      width={drawing.width}
      height={GRAPH.row}
      viewBox={`0 0 ${drawing.width} ${GRAPH.row}`}
      className="shrink-0 text-muted-foreground/50"
    >
      {drawing.lines.map((d) => (
        <path key={d} d={d} fill="none" strokeWidth={2} className="stroke-current" />
      ))}
      <ShapeAt shape={row.shape} x={drawing.node.x} y={drawing.node.y} />
    </svg>
  );
}

/**
 * Everyone's changes as `jj log` draws them: newest first, the lanes beside the rows, trunk's newest
 * landed change at the end. Mine dims the rows the person does not run, own or review; they stay
 * listed and pressable.
 */
export function ChangeGraph({
  graph,
  scoped,
  models,
  landed,
  selected,
  onSelect,
}: {
  readonly graph: ChangeGraphLayout;
  readonly scoped: ReadonlyArray<ScopedRow>;
  readonly models: ReadonlyMap<string, ChangeRowModel>;
  readonly landed: LandedRowModel | undefined;
  readonly selected: string | undefined;
  readonly onSelect: (id: string) => void;
}) {
  return (
    <ul aria-label="Change graph" className="flex flex-col">
      {scoped.map(({ row, dimmed }) => {
        const model = row.kind === "change" ? models.get(row.id) : undefined;
        const isSelected = selected === row.id;
        const words = SHAPE_WORDS[row.shape];
        return (
          <li key={row.id} className="flex h-18 items-stretch">
            <RowLines row={row} lanes={graph.lanes} />
            <button
              type="button"
              aria-pressed={isSelected}
              data-dimmed={dimmed ? "" : undefined}
              onClick={() => onSelect(row.id)}
              className={cn(
                "my-1.5 flex min-w-0 flex-1 flex-col justify-center gap-1 rounded-lg border px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                isSelected ? "border-input bg-accent" : "border-transparent hover:bg-accent/50",
              )}
            >
              <span className="sr-only">{words}</span>
              {model !== undefined ? (
                <ChangeRowBody model={model} dimmed={dimmed} />
              ) : landed === undefined ? null : (
                <LandedRowBody landed={landed} />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ChangeRowBody({
  model,
  dimmed,
}: {
  readonly model: ChangeRowModel;
  readonly dimmed: boolean;
}) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <ChangeId {...model.id} />
        {model.key === undefined ? null : (
          <span className="shrink-0 rounded-sm bg-muted px-1 font-mono text-2xs text-muted-foreground">
            {model.key}
          </span>
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm font-semibold",
            dimmed ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {model.title}
        </span>
        {model.stat === "" ? null : (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{model.stat}</span>
        )}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span
          aria-hidden
          className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-semibold text-muted-foreground"
        >
          {model.who.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {model.who} · {model.source}
        </span>
        {model.badges.map((badge) => (
          <Badge
            key={`${badge.id}:${badge.link ?? ""}`}
            variant={BADGE_VARIANT[badge.tone]}
            size="sm"
          >
            <BadgeMark id={badge.id} />
            {badge.label}
          </Badge>
        ))}
      </span>
    </>
  );
}

function LandedRowBody({ landed }: { readonly landed: LandedRowModel }) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <ChangeId {...landed.id} />
        <span className="shrink-0 rounded-sm bg-muted px-1 font-mono text-2xs text-muted-foreground">
          {landed.key}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {landed.title}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-xs text-muted-foreground">{landed.who}</span>
        <Badge variant="outline" size="sm">
          Landed
        </Badge>
      </span>
    </>
  );
}
