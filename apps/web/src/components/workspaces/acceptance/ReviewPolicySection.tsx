import { useAtomValue } from "@effect/atom-react";
import { acceptedAtLabel, mayAccept, personName } from "@t3tools/client-runtime/peer/acceptance";
import type { PeerReviewPolicyMode } from "@t3tools/contracts";
import { useId, useState } from "react";

import { cn } from "../../../lib/utils";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { Radio, RadioGroup } from "../../ui/radio-group";
import { PageSection } from "../settings/CapacityCoordinationParts";
import type { ProjectSettingsSlotProps } from "../slots.types";
import { failureMessage } from "../WorkspaceAccess";
import { withFinally } from "~/lib/withFinally";
import {
  isReviewPolicyMode,
  REVIEW_POLICY_CHOICES,
  REVIEW_SIGNAL_LINES,
  reviewPolicyView,
  saveOutcome,
} from "./reviewPolicy.logic";

/**
 * The project's review policy on its Coordination tab: whether an agent's handoff waits for a
 * person or is accepted when nothing speaks against it, with what speaks against it. Leads and
 * admins save it from the version they read; members read it.
 */
export function ReviewPolicySection({
  environmentId,
  status,
  workspace,
  state,
}: ProjectSettingsSlotProps) {
  const idBase = useId();
  const place = { workspace: workspace.slug, project: state.project.id };
  const query = useEnvironmentQuery(
    serverEnvironment.peerAcceptanceReviewPolicy({ environmentId, input: place }),
  );
  const save = useAtomCommand(serverEnvironment.peerAcceptanceSetReviewPolicy, {
    reportFailure: false,
  });
  const allowed = useAtomValue(
    serverEnvironment.peerAcceptanceSetReviewPolicy.permissionAtom(environmentId),
  );
  const nameOf = (email: string) => personName(status, workspace.slug, email);
  const view = reviewPolicyView(
    query.data,
    allowed && mayAccept(workspace, state.project),
    nameOf,
    acceptedAtLabel,
  );
  const [chosen, setChosen] = useState<PeerReviewPolicyMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const title = "Review policy";
  if (view.kind === "loading") {
    return (
      <PageSection title={title}>
        <p role="status" className="text-sm text-muted-foreground">
          {query.error ?? "Reading the review policy…"}
        </p>
      </PageSection>
    );
  }
  if (view.kind === "older-hub") {
    return (
      <PageSection title={title}>
        <p className="text-sm text-muted-foreground">
          This Hub does not keep a review policy yet: a person reviews every handoff.
        </p>
      </PageSection>
    );
  }
  const value = chosen ?? view.mode;
  const submit = async () => {
    if (chosen === null || chosen === view.mode) return;
    setBusy(true);
    setMessage(null);
    await withFinally(
      async () => {
        const result = await save({
          environmentId,
          input: { ...place, mode: chosen, version: view.version },
        });
        if (result._tag === "Success") {
          setMessage(saveOutcome(result.value, nameOf));
          setChosen(null);
        } else {
          setMessage(failureMessage(result) ?? "Could not save the review policy.");
        }
        query.refresh();
      },
      () => setBusy(false),
    );
  };
  return (
    <PageSection
      title={title}
      description="Whether an agent’s handoff waits for a person, or is accepted when nothing speaks against it."
    >
      <RadioGroup
        aria-label={`Review policy for ${state.project.name}`}
        value={value}
        disabled={!view.canSave || busy}
        onValueChange={(next) => {
          if (isReviewPolicyMode(next)) setChosen(next === view.mode ? null : next);
        }}
      >
        <div className="overflow-hidden rounded-xl border bg-card">
          {REVIEW_POLICY_CHOICES.map((choice) => (
            <label
              key={choice.value}
              className={cn(
                "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 border-b px-3.5 py-2.5 last:border-b-0 sm:grid-cols-[auto_9.5rem_minmax(0,1fr)]",
                view.canSave ? "cursor-pointer" : "cursor-not-allowed",
              )}
            >
              <Radio
                value={choice.value}
                aria-labelledby={`${idBase}-${choice.value}-title`}
                aria-describedby={`${idBase}-${choice.value}-description`}
              />
              <span id={`${idBase}-${choice.value}-title`} className="text-sm font-medium">
                {choice.title}
              </span>
              <span
                id={`${idBase}-${choice.value}-description`}
                className="col-start-2 text-xs text-muted-foreground sm:col-start-auto"
              >
                {choice.description}
              </span>
            </label>
          ))}
        </div>
      </RadioGroup>
      <div className="flex flex-col gap-1">
        <p className="text-sm text-foreground">A person is asked when:</p>
        <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm text-muted-foreground">
          {REVIEW_SIGNAL_LINES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">{view.setBy}</p>
      {view.canSave ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={busy || chosen === null || chosen === view.mode}
            onClick={() => void submit()}
          >
            {busy ? "Saving…" : "Save review policy"}
          </Button>
          {chosen === null ? null : (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setChosen(null)}>
              Cancel
            </Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          The project’s leads and the workspace’s admins change this.
        </p>
      )}
      {message === null ? null : (
        <p role="alert" className="text-sm text-foreground">
          {message}
        </p>
      )}
    </PageSection>
  );
}
