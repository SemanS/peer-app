import { useAtomValue } from "@effect/atom-react";
import { acceptanceRevision } from "@t3tools/client-runtime/peer/acceptance";
import type { PeerTaskAcceptance } from "@t3tools/contracts";
import { useState } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { Button } from "../../ui/button";
import { PeerSectionLabel } from "../PeerPageHeader";
import type { TaskSlotProps } from "../slots.types";
import { acceptanceCard, acceptanceFacts } from "./acceptance.logic";
import { openAcceptanceDialog } from "./acceptanceDialog";

const ACTION_LABEL = { accept: "Accept…", withdraw: "Withdraw acceptance…" } as const;

/**
 * A task's acceptance on its page: who accepted it and when, with their note, every acceptance
 * and withdrawal before it, and "Done · not accepted" for a done task without one. Leads and
 * admins get Accept… or Withdraw…; everyone else reads the same card without them. The card is read
 * again whenever the status says the acceptance changed; what was read last stays on screen while
 * the next read is on its way.
 */
export function AcceptanceCard(props: TaskSlotProps) {
  const projectId = props.project?.project.id;
  const allowed = useAtomValue(
    serverEnvironment.peerAcceptanceAccept.permissionAtom(props.environmentId),
  );
  const place =
    projectId === undefined
      ? undefined
      : { workspace: props.workspace, project: projectId, task: props.task.id };
  const facts = place === undefined ? undefined : acceptanceFacts(props.status, place, allowed);
  const query = useEnvironmentQuery(
    place === undefined
      ? null
      : serverEnvironment.peerAcceptanceView({
          environmentId: props.environmentId,
          input: place,
          revision: acceptanceRevision(props.status, place),
        }),
  );
  const key =
    place === undefined
      ? ""
      : `${props.environmentId}/${place.workspace}/${place.project}/${place.task}`;
  const [kept, setKept] = useState<
    { readonly key: string; readonly view: PeerTaskAcceptance } | undefined
  >(undefined);
  const read = query.data ?? undefined;
  if (read !== undefined && (kept?.view !== read || kept.key !== key)) setKept({ key, view: read });
  const view = read ?? (kept?.key === key ? kept.view : undefined);
  if (facts === undefined) return null;
  const card = acceptanceCard(facts, view);
  if (card === null) return null;
  return (
    <section aria-label="Acceptance" className="flex flex-col gap-2">
      <PeerSectionLabel>Acceptance</PeerSectionLabel>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className={
            card.tone === "accepted"
              ? "text-sm font-medium text-success-foreground"
              : "text-sm text-foreground"
          }
        >
          {card.heading}
        </p>
        {card.actions.length === 0 ? null : (
          <div className="flex gap-2">
            {card.actions.map((kind) => (
              <Button
                key={kind}
                size="sm"
                variant="outline"
                onClick={() =>
                  openAcceptanceDialog({
                    kind,
                    environmentId: props.environmentId,
                    ...facts.place,
                  })
                }
              >
                {ACTION_LABEL[kind]}
              </Button>
            ))}
          </div>
        )}
      </div>
      {card.note === undefined ? null : (
        <p className="max-w-prose text-sm whitespace-pre-wrap text-foreground">{card.note}</p>
      )}
      {card.hint === undefined ? null : (
        <p className="max-w-prose text-sm text-muted-foreground">{card.hint}</p>
      )}
      {query.error === null ? null : (
        <p role="alert" className="text-sm text-destructive-foreground">
          {query.error}
        </p>
      )}
      {card.history.length === 0 ? null : (
        <ul aria-label="Acceptance history" className="flex flex-col gap-1.5">
          {card.history.map((row) => (
            <li key={row.key} className="flex flex-col text-sm text-muted-foreground">
              <span>{row.line}</span>
              {row.note === undefined ? null : (
                <span className="whitespace-pre-wrap text-foreground">{row.note}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
