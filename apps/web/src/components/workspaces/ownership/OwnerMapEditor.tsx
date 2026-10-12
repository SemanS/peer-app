import {
  ownerName,
  projectLeads,
  type ProjectOwnership,
} from "@t3tools/client-runtime/peer/ownership";
import type { EnvironmentId } from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import { Input } from "../../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { PeerCard } from "../PeerPageHeader";
import { ownershipFailure } from "./failure";
import {
  addPath,
  areaEdited,
  canAddPath,
  canSave,
  changeCount,
  changeWords,
  conflictText,
  draftMap,
  draftOf,
  editPath,
  footerText,
  mapChanges,
  pathEdited,
  rebase,
  removePath,
  rowNotes,
  rowProblems,
  saveInput,
  setAreaOwner,
  type DraftArea,
  type DraftPath,
  type OwnerMapDraft,
} from "./ownerMapDraft.logic";
import { NO_OWNER } from "./OwnerPicker";
import type { OwnerMapSummary } from "./team.logic";

/** The first choice of an owner's picker where a pattern has none yet. */
const CHOOSE = "";

/** What a save that found the map changed leaves for the person to read. */
interface Conflict {
  readonly version: number;
  /** Who saved it, by name; undefined where the Hub does not say. */
  readonly by: string | undefined;
  readonly lead: boolean;
  /** What the other save changed, in words after the saver's name. */
  readonly theirs: ReadonlyArray<string>;
}

/**
 * The owner map of a project: an owner for each area, and for each path pattern whether its owner
 * decides changes by others there. A lead or an admin edits it and saves it whole, from the version
 * they opened; for everybody else the same lists are read-only. When the map changed since it was
 * opened the save is refused, and the editor keeps what the person did on top of the version that
 * is saved now, says who saved it and what they changed, and waits for another save. The Hub
 * refuses what it cannot take (a pattern it does not support, an owner who is not on the project),
 * and the editor says why and keeps the draft.
 */
export function OwnerMapEditor({
  environmentId,
  ownership,
  areas,
  summary,
}: {
  readonly environmentId: EnvironmentId;
  readonly ownership: ProjectOwnership;
  /** The project's areas, in its order. */
  readonly areas: ReadonlyArray<string>;
  /** The map as the Hub last said it, in words, for everybody who cannot edit it. */
  readonly summary: OwnerMapSummary;
}) {
  const editable = ownership.canManage;
  const setMap = useAtomCommand(serverEnvironment.peerOwnership.setMap, { reportFailure: false });
  const hub = ownership.view.map;
  // What the person has made of the map, until they have made nothing and the Hub has a newer
  // version: a draft with no edits follows the Hub, since there is nothing to lose and no conflict
  // to come.
  const [held, setDraft] = useState<OwnerMapDraft | null>(null);
  // Area names are single lines, so the list can be told from another by its joined text.
  const areasKey = areas.join("\n");
  const fresh = useMemo(
    () => draftOf(hub, areasKey === "" ? [] : areasKey.split("\n")),
    [hub, areasKey],
  );
  const draft =
    held !== null && (hub.version <= held.base.version || changeCount(held) > 0) ? held : fresh;
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [comparing, setComparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  // A second save before the first is answered would send the same map twice.
  const sending = useRef(false);
  if (!editable) return <ReadOnlyMap summary={summary} />;

  const name = (email: string) => ownerName(ownership, email);
  const edit = (next: OwnerMapDraft) => {
    setDraft(next);
    setError(null);
    setSaved(null);
  };
  const problems = rowProblems(draft);
  const notes = rowNotes(draft, ownership);
  const items = ownerItems(ownership, draft);
  const save = async () => {
    if (sending.current || busy || !canSave(draft)) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await setMap({
        environmentId,
        input: saveInput(draft, { workspace: ownership.workspace, project: ownership.project }),
      });
      if (result._tag !== "Success") {
        setError(ownershipFailure(result));
        return;
      }
      if (result.value.kind === "saved") {
        setDraft(draftOf(result.value.map, areas));
        setConflict(null);
        setComparing(false);
        setSaved(result.value.map.version);
        return;
      }
      const current = result.value.map;
      const merged = rebase(draft, current, areas);
      const by = current.updatedBy?.toLowerCase();
      setDraft(merged);
      setComparing(false);
      setConflict({
        version: current.version,
        by: by === undefined ? undefined : name(by),
        lead: by !== undefined && projectLeads(ownership).includes(by),
        theirs: mapChanges(draft.base, current).map((change) => changeWords(change, name)),
      });
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const discard = () => {
    // Back to the map as it is known now: after a lost save, the version that came first.
    setDraft(draftOf(draft.base, areas));
    setConflict(null);
    setComparing(false);
    setError(null);
    setSaved(null);
  };
  return (
    <>
      <div className="flex flex-col gap-5">
        {conflict === null ? null : (
          <ConflictNote
            conflict={conflict}
            edits={changeCount(draft)}
            comparing={comparing}
            onCompare={() => setComparing(!comparing)}
          />
        )}
        {conflict === null || !comparing ? null : (
          <Comparison
            conflict={conflict}
            mine={mapChanges(draft.base, draftMap(draft)).map((change) =>
              changeWords(change, name),
            )}
          />
        )}
        <MapSection title="Areas" hint="A task without its own owner is owned through its area.">
          {draft.areas.map((row) => (
            <AreaRow
              key={row.area}
              row={row}
              edited={areaEdited(draft, row)}
              items={items}
              disabled={busy}
              onOwner={(owner) => edit(setAreaOwner(draft, row.area, owner))}
            />
          ))}
        </MapSection>
        <MapSection
          title="Paths"
          hint="The most specific pattern decides, as in coordination path patterns. With Owner decides on, another person's agent waits for the owner's call before it changes such a path."
          footer="If an owner leaves the project, the project's leads decide that pattern's calls until a new owner is set."
        >
          {draft.paths.map((row) => (
            <PathRow
              key={row.id}
              row={row}
              edited={pathEdited(draft, row)}
              problem={problems.get(row.id)}
              note={notes.get(row.id)}
              items={items}
              disabled={busy}
              onEdit={(change) => edit(editPath(draft, row.id, change))}
              onRemove={() => edit(removePath(draft, row.id))}
            />
          ))}
          <li className="px-4 py-2.5">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !canAddPath(draft)}
              onClick={() => edit(addPath(draft))}
            >
              Add a path pattern
            </Button>
          </li>
        </MapSection>
      </div>
      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 shadow-xs">
        <span className="min-w-0 flex-1 basis-48 text-sm text-foreground">
          {error === null ? (
            saved !== null && changeCount(draft) === 0 ? (
              <span role="status">{`Saved as version ${saved}.`}</span>
            ) : (
              footerText(draft)
            )
          ) : (
            <span role="alert" className="text-destructive-foreground">
              {error}
            </span>
          )}
        </span>
        <Button size="sm" variant="outline" disabled={busy} onClick={discard}>
          Discard
        </Button>
        <Button size="sm" disabled={busy || !canSave(draft)} onClick={() => void save()}>
          {busy ? "Saving…" : "Save owner map"}
        </Button>
      </div>
    </>
  );
}

/** The people an owner can be picked from: the project's members, then owners who left but are in the map. */
function ownerItems(
  ownership: ProjectOwnership,
  draft: OwnerMapDraft,
): ReadonlyArray<{ readonly value: string; readonly label: string }> {
  const members = [...ownership.people.keys()]
    .map((email) => ({ value: email, label: ownerName(ownership, email) }))
    .toSorted((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
  const left = [
    ...new Set([
      ...draft.areas.flatMap((row) => (row.owner === null ? [] : [row.owner])),
      ...draft.paths.flatMap((row) => (row.owner === null ? [] : [row.owner])),
    ]),
  ]
    .filter((email) => !ownership.people.has(email))
    .map((email) => ({ value: email, label: `${ownerName(ownership, email)} (left the project)` }));
  return [...members, ...left];
}

/** One group of rows under its heading and what it means. */
function MapSection({
  title,
  hint,
  footer,
  children,
}: {
  readonly title: string;
  readonly hint: string;
  readonly footer?: string;
  readonly children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
        {children}
      </ul>
      {footer === undefined ? null : <p className="text-xs text-muted-foreground">{footer}</p>}
    </section>
  );
}

/** A picker of an owner: the members, and "No owner" where a row may have none. */
function OwnerSelect({
  label,
  value,
  items,
  none,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly items: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  /** The row may have no owner: the first choice takes it away. */
  readonly none: boolean;
  readonly disabled: boolean;
  readonly onChange: (owner: string | null) => void;
}) {
  const choices = none ? [{ value: NO_OWNER, label: "No owner" }, ...items] : items;
  const current = value ?? (none ? NO_OWNER : CHOOSE);
  return (
    <div className="w-44">
      <Select
        value={current}
        disabled={disabled}
        items={[...choices, { value: CHOOSE, label: "Choose an owner" }]}
        onValueChange={(next) => {
          if (typeof next === "string")
            onChange(next === NO_OWNER || next === CHOOSE ? null : next);
        }}
      >
        <SelectTrigger size="sm" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {choices.map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}

const EditMark = () => (
  <Badge variant="info" size="lg">
    Your edit
  </Badge>
);

function AreaRow({
  row,
  edited,
  items,
  disabled,
  onOwner,
}: {
  readonly row: DraftArea;
  readonly edited: boolean;
  readonly items: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly disabled: boolean;
  readonly onOwner: (owner: string | null) => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2">
      <span className="min-w-0 flex-1 basis-48 text-sm font-semibold break-words text-foreground">
        {row.area}
        {row.stale ? (
          <span className="font-normal text-muted-foreground">
            {" "}
            · not an area of this project any more
          </span>
        ) : null}
      </span>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Owner
        <OwnerSelect
          label={`Owner of ${row.area}`}
          value={row.owner}
          items={items}
          none
          disabled={disabled}
          onChange={onOwner}
        />
      </label>
      {edited ? <EditMark /> : null}
    </li>
  );
}

function PathRow({
  row,
  edited,
  problem,
  note,
  items,
  disabled,
  onEdit,
  onRemove,
}: {
  readonly row: DraftPath;
  readonly edited: boolean;
  readonly problem: string | undefined;
  readonly note: string | undefined;
  readonly items: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly disabled: boolean;
  readonly onEdit: (change: Partial<Pick<DraftPath, "pattern" | "owner" | "decides">>) => void;
  readonly onRemove: () => void;
}) {
  return (
    <li className="flex flex-col gap-1.5 px-4 py-2.5">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <label className="flex min-w-0 flex-1 basis-60 flex-col gap-1 text-xs text-muted-foreground">
          Pattern
          <Input
            nativeInput
            size="sm"
            font="mono"
            aria-label="Pattern"
            aria-invalid={problem !== undefined}
            value={row.pattern}
            disabled={disabled}
            onChange={(event) => onEdit({ pattern: event.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Owner
          <OwnerSelect
            label={`Owner of ${row.pattern.trim() === "" ? "the new pattern" : row.pattern.trim()}`}
            value={row.owner}
            items={items}
            none={false}
            disabled={disabled}
            onChange={(owner) => onEdit({ owner })}
          />
        </label>
        <label className="flex min-h-7 items-center gap-2 text-sm text-foreground">
          <Checkbox
            checked={row.decides}
            disabled={disabled}
            onCheckedChange={(checked) => onEdit({ decides: checked })}
          />
          Owner decides
        </label>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Remove pattern"
          disabled={disabled}
          onClick={onRemove}
        >
          <XIcon aria-hidden />
        </Button>
        {edited ? <EditMark /> : null}
      </div>
      {problem === undefined ? null : (
        <p role="alert" className="text-xs text-destructive-foreground">
          {problem}
        </p>
      )}
      {note === undefined ? null : <p className="text-xs text-info-foreground">{note}</p>}
    </li>
  );
}

/** That another save came first, who made it, and what the editor kept. */
function ConflictNote({
  conflict,
  edits,
  comparing,
  onCompare,
}: {
  readonly conflict: Conflict;
  readonly edits: number;
  readonly comparing: boolean;
  readonly onCompare: () => void;
}) {
  const text = conflictText({ ...conflict, edits });
  return (
    <section
      role="alert"
      className="flex flex-wrap items-center gap-3.5 rounded-xl border border-warning/30 bg-warning/8 px-4 py-3.5"
    >
      <span className="flex min-w-0 flex-1 basis-80 flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">{text.title}</span>
        <span className="text-sm text-muted-foreground">{text.body}</span>
      </span>
      <Button size="sm" variant="warning-outline" aria-expanded={comparing} onClick={onCompare}>
        {comparing ? "Hide the comparison" : `Compare with version ${conflict.version}`}
      </Button>
    </section>
  );
}

/** The other save's changes beside the draft's, so the person reviews one against the other. */
function Comparison({
  conflict,
  mine,
}: {
  readonly conflict: Conflict;
  readonly mine: ReadonlyArray<string>;
}) {
  const list = (lines: ReadonlyArray<string>, who: string, none: string) =>
    lines.length === 0 ? (
      <p className="text-sm text-muted-foreground">{none}</p>
    ) : (
      <ul className="flex flex-col gap-1 text-sm text-foreground">
        {lines.map((line) => (
          <li key={line}>
            {who} {line}
          </li>
        ))}
      </ul>
    );
  return (
    <PeerCard aria-label={`Comparison with version ${conflict.version}`}>
      <h2 className="text-sm font-semibold text-foreground">
        Changed in version {conflict.version}
      </h2>
      {list(conflict.theirs, conflict.by ?? "They", "Nothing of the map itself changed.")}
      <h2 className="text-sm font-semibold text-foreground">Your edits on top of it</h2>
      {list(mine, "You", `None: version ${conflict.version} already has your edits.`)}
    </PeerCard>
  );
}

/** The map for someone who may not change it: the same lists, as text. */
function ReadOnlyMap({ summary }: { readonly summary: OwnerMapSummary }) {
  return (
    <div className="flex flex-col gap-5">
      <MapSection title="Areas" hint="A task without its own owner is owned through its area.">
        {summary.areas.map((area) => (
          <li key={area.name} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
            <span className="min-w-0 flex-1 basis-48 font-semibold break-words text-foreground">
              {area.name}
              {area.stale ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · not an area of this project any more
                </span>
              ) : null}
            </span>
            <span className="text-foreground">{area.owner ?? "No owner"}</span>
          </li>
        ))}
      </MapSection>
      <MapSection
        title="Paths"
        hint="The most specific pattern decides, as in coordination path patterns. With Owner decides on, another person's agent waits for the owner's call before it changes such a path."
        footer="If an owner leaves the project, the project's leads decide that pattern's calls until a new owner is set."
      >
        {summary.paths.length === 0 ? (
          <li className="px-4 py-2.5 text-sm text-muted-foreground">No path has an owner.</li>
        ) : (
          summary.paths.map((path) => (
            <li
              key={path.pattern}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 basis-60 font-mono text-xs break-all text-foreground">
                {path.pattern}
              </span>
              <span className="text-foreground">{path.owner ?? "No owner"}</span>
              {path.decides ? (
                <Badge variant="warning" size="lg">
                  Owner decides
                </Badge>
              ) : null}
            </li>
          ))
        )}
      </MapSection>
    </div>
  );
}
