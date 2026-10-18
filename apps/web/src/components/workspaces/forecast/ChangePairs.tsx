import { Link } from "@tanstack/react-router";
import { personName } from "@t3tools/client-runtime/peer/jujutsu";
import { useRelativeTimeTick } from "../../settings/settingsLayout";
import { Badge } from "../../ui/badge";
import { PeerSectionLabel } from "../PeerPageHeader";
import type { ChangeSlotProps } from "../slots.types";
import {
  changePairRows,
  cleanPairLine,
  conflictFiles,
  checkResultLine,
  type ChangePairRow,
} from "./integration.logic";
import { PairActionsSlot } from "./PairActionsSlot";
import { useForecast } from "./useForecast";

function Row({
  row,
  command,
  now,
  props,
}: {
  readonly row: ChangePairRow;
  readonly command: string | undefined;
  readonly now: number;
  readonly props: ChangeSlotProps;
}) {
  const { pair, other, kind, meets } = row;
  const name = `${other.task ?? other.branch} · ${personName(other.email)}`;
  const result = checkResultLine(pair, command);
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5 text-xs">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 font-medium text-foreground">{meets ?? name}</span>
        <Badge
          variant={kind === "clean" ? "success" : kind === "meets" ? "secondary" : "warning"}
          size="sm"
        >
          {kind === "conflict"
            ? "Conflict"
            : kind === "meets"
              ? "Meets a conflict"
              : kind === "check-fails"
                ? "Check fails"
                : "Merges clean"}
        </Badge>
      </div>
      {kind === "conflict" ? (
        <p className="text-muted-foreground">Conflict in {conflictFiles(pair)}</p>
      ) : kind === "meets" ? (
        <p className="text-muted-foreground">
          Shown once, on that pair in the integration preview.
        </p>
      ) : kind === "check-fails" ? (
        <p className="text-muted-foreground">
          Merges clean. {result}. The output is in the integration preview.
        </p>
      ) : (
        <p className="text-muted-foreground">{cleanPairLine(pair, command, now)}</p>
      )}
      {kind === "conflict" || kind === "check-fails" ? (
        <div className="flex flex-wrap items-center gap-2">
          <PairActionsSlot
            environmentId={props.environmentId}
            status={props.status}
            workspace={props.workspace}
            project={props.project?.project.id ?? ""}
            pair={pair}
          />
        </div>
      ) : null}
    </li>
  );
}

/**
 * The selected change's pairs, in the Changes inspector. It is advice: nothing here stops a step,
 * and the preview page holds the pairs of every change.
 */
export function ChangePairs(props: ChangeSlotProps) {
  const { value } = useForecast(props.environmentId, props.status),
    now = useRelativeTimeTick(30_000),
    project = props.project?.project.id;
  if (project === undefined) return null;
  const rows = changePairRows(value, props.change, { workspace: props.workspace, project });
  if (rows.length === 0) return null;
  const command = value !== "unavailable" ? value.check : undefined;
  return (
    <section aria-label="With the other changes" className="flex flex-col gap-2">
      <PeerSectionLabel>With the other changes</PeerSectionLabel>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <Row key={row.key} row={row} command={command} now={now} props={props} />
        ))}
      </ul>
      <Link
        to="/integration/$workspace/$project"
        params={{ workspace: props.workspace, project }}
        className="w-fit rounded-sm text-xs font-medium text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        Integration preview
      </Link>
    </section>
  );
}
