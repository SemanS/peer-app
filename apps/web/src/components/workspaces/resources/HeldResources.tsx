import { useState } from "react";
import {
  heldResources,
  mayRelease,
  releaseInput,
  resourceLabel,
  resourceTimeLeft,
  createResourcesEnvironmentAtoms,
} from "@t3tools/client-runtime/peer/resources";
import { useNowMinute } from "../../../hooks/useNowMinute";
import { connectionAtomRuntime } from "../../../connection/runtime";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { failureMessage } from "../WorkspaceAccess";
import type { PeerSlotProps } from "../slots.types";
import { withFinally } from "~/lib/withFinally";
const atoms = createResourcesEnvironmentAtoms(connectionAtomRuntime);
export function HeldResources({ environmentId, status }: PeerSlotProps) {
  const minute = useNowMinute();
  const now = Date.parse(`${minute}:00Z`);
  const [clock, setClock] = useState({ slice: status.resources, at: now });
  if (clock.slice !== status.resources) setClock({ slice: status.resources, at: now });
  const observedAt = clock.slice === status.resources ? clock.at : now;
  const rows = heldResources(status);
  const release = useAtomCommand(atoms.release);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function drop(hold: (typeof rows)[number]) {
    setBusy(true);
    setError(null);
    await withFinally(
      async () => {
        setError(failureMessage(await release({ environmentId, input: releaseInput(hold) })));
      },
      () => {
        setBusy(false);
      },
    );
  }
  if (!rows.length) return null;
  return (
    <section aria-label="Held resources" className="flex flex-col gap-2 px-2">
      <h2 className="text-xs font-medium text-secondary-label">Held resources</h2>
      {rows.map((h) => (
        <div
          key={`${h.workspace}/${h.project}/${h.kind}/${h.name}`}
          className="flex items-start justify-between gap-2"
        >
          <div className="min-w-0">
            <p className="break-words text-sm">{resourceLabel(h)}</p>
            <p className="text-xs text-muted-foreground">
              {h.project} · {h.holder.email === status.email ? "Your agent" : h.holder.email} ·{" "}
              {resourceTimeLeft(h, observedAt, now)}
            </p>
            {h.intent ? (
              <p className="break-words text-xs text-muted-foreground">“{h.intent}”</p>
            ) : null}
          </div>
          {mayRelease(status, h) ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void drop(h)}>
              Release
            </Button>
          ) : null}
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-xs">
          {error}
        </p>
      ) : null}
    </section>
  );
}
