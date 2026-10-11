import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { PeerCard } from "../PeerPageHeader";
import type { NoProjectsSlotProps } from "../slots.types";
import { failureMessage } from "../WorkspaceAccess";
import {
  adminWords,
  adminsOf,
  alreadyAsked,
  askInput,
  askRefusal,
  listNames,
  memberWords,
} from "./noProjects.logic";

/**
 * The settings plugin's part of Work's empty state: what to do in a workspace with no project for
 * the person. An admin starts one or imports the workspace's YAML, in the settings area; a member
 * asks an admin to add them, which sends a request without changes through the plugin, so people
 * are not sent to YAML, a command or someone who could not act in the app.
 */
export function SettingsNoProjects(props: NoProjectsSlotProps) {
  return props.workspace.role === "member" ? (
    <AskToBeAdded {...props} />
  ) : (
    <StartAProject {...props} />
  );
}

function StartAProject({ status, workspace }: NoProjectsSlotProps) {
  const navigate = useNavigate();
  const words = adminWords({
    workspaceName: workspace.name,
    several: status.workspaces.length > 1,
  });
  return (
    <PeerCard aria-label={words.title} className="items-center text-center">
      <h3 className="text-sm font-semibold text-foreground">{words.title}</h3>
      <p className="text-xs leading-relaxed text-muted-foreground">{words.text}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          size="sm"
          onClick={() =>
            void navigate({
              to: "/settings/peer/w/$workspace/$section",
              params: { workspace: workspace.slug, section: "new-project" },
            })
          }
        >
          Create project
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void navigate({
              to: "/settings/peer/w/$workspace/$section",
              params: { workspace: workspace.slug, section: "general" },
              hash: "yaml",
            })
          }
        >
          Import YAML
        </Button>
      </div>
    </PeerCard>
  );
}

function AskToBeAdded({ environmentId, status, workspace }: NoProjectsSlotProps) {
  const person = status.email;
  const slug = workspace.slug;
  // Who the admins are and the revision to ask on change rarely, so the view is not read again
  // each time the workspace's settings move: a request names the revision it last read.
  const view = useEnvironmentQuery(
    person === null
      ? null
      : serverEnvironment.peerSettings.view({
          environmentId,
          person,
          input: { workspace: slug },
        }),
  );
  const waiting = useEnvironmentQuery(
    person === null
      ? null
      : serverEnvironment.peerSettings.proposals({
          environmentId,
          person,
          input: { workspace: slug, state: "pending" },
        }),
  );
  const propose = useAtomCommand(serverEnvironment.peerSettings.propose, { reportFailure: false });
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const admins = adminsOf(view.data?.people ?? []);
  const words = memberWords({ workspaceName: workspace.name, admins });
  const asked = sent || alreadyAsked(waiting.data?.proposals ?? []);

  const ask = async () => {
    if (view.data === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await propose({
        environmentId,
        input: askInput(slug, view.data.revision.seq),
      });
      const failure = failureMessage(result);
      if (failure !== null) {
        setError(failure);
      } else if (result._tag === "Success") {
        const refusal = askRefusal(result.value);
        if (refusal === null) {
          setSent(true);
          waiting.refresh();
        } else {
          setError(refusal);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <PeerCard aria-label={words.title} className="items-center text-center">
      <h3 className="text-sm font-semibold text-foreground">{words.title}</h3>
      <p className="text-xs leading-relaxed text-muted-foreground">{words.text}</p>
      {asked ? (
        <p role="status" className="text-xs text-foreground">
          {admins.length === 0
            ? "Asked the admins."
            : `Asked ${listNames(admins.map((admin) => admin.name))}.`}{" "}
          Your projects appear here once one of them adds you.
        </p>
      ) : (
        <Button size="sm" disabled={busy || view.data === null} onClick={() => void ask()}>
          {words.ask}
        </Button>
      )}
      {error === null && view.error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {error ?? view.error}
        </p>
      )}
    </PeerCard>
  );
}
