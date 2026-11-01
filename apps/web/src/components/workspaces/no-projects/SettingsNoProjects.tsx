import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, ChevronRightIcon } from "lucide-react";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { PeerCard } from "../PeerPageHeader";
import type { NoProjectsSlotProps } from "../slots.types";
import { adminWords, adminsOf, memberWords } from "./noProjects.logic";
import { firstRunSteps } from "./firstRun.logic";

/**
 * The settings plugin's part of Work's empty state: what to do in a workspace with no project for
 * the person. An admin starts one in the settings area; a member hears who can add them.
 */
export function SettingsNoProjects(props: NoProjectsSlotProps) {
  return props.workspace.role === "member" ? (
    <WaitToBeAdded {...props} />
  ) : (
    <StartAProject {...props} />
  );
}

/**
 * A new organization's first steps for its owners and admins: a project or repository, colleagues
 * and tools. Each opens its settings page and is ticked from what the settings and invitations
 * already say.
 */
function StartAProject({ environmentId, status, workspace }: NoProjectsSlotProps) {
  const navigate = useNavigate();
  const person = status.email;
  const slug = workspace.slug;
  const view = useEnvironmentQuery(
    person === null
      ? null
      : serverEnvironment.peerSettings.view({ environmentId, person, input: { workspace: slug } }),
  );
  const invitations = useEnvironmentQuery(
    serverEnvironment.peerHubInvitations({ environmentId, input: { workspace: slug } }),
  );
  const listed = invitations.data?.invitations;
  const steps = firstRunSteps({
    projects: workspace.projects.length,
    document: view.data?.document ?? null,
    people: view.data === null ? null : view.data.people.length,
    invitations:
      listed === undefined
        ? null
        : listed.filter(
            (entry) =>
              entry.status === undefined ||
              entry.status === "pending" ||
              entry.status === "accepted",
          ).length,
  });
  const words = adminWords({
    workspaceName: workspace.name,
    several: status.workspaces.length > 1,
  });
  const open = (section: (typeof steps)[number]["section"]) =>
    void navigate({
      to: "/settings/peer/w/$workspace/$section",
      params: { workspace: slug, section },
    });
  return (
    <PeerCard aria-label={words.title}>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground">{words.title}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{words.text}</p>
      </div>
      <ol className="flex flex-col divide-y divide-border/60">
        {steps.map((step, index) => (
          <li key={step.id}>
            <button
              type="button"
              className="flex w-full items-start gap-3 rounded-md py-2.5 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              onClick={() => open(step.section)}
            >
              <span
                aria-hidden
                className={
                  step.done === true
                    ? "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success"
                    : "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-2xs text-muted-foreground tabular-nums"
                }
              >
                {step.done === true ? <CheckIcon className="size-3" /> : index + 1}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm text-foreground">
                  {step.title}
                  {step.done === true ? <span className="sr-only"> (done)</span> : null}
                </span>
                <span className="text-xs text-muted-foreground">{step.text}</span>
              </span>
              <ChevronRightIcon
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
            </button>
          </li>
        ))}
      </ol>
    </PeerCard>
  );
}

function WaitToBeAdded({ environmentId, status, workspace }: NoProjectsSlotProps) {
  const person = status.email;
  const view = useEnvironmentQuery(
    person === null
      ? null
      : serverEnvironment.peerSettings.view({
          environmentId,
          person,
          input: { workspace: workspace.slug },
        }),
  );
  const words = memberWords({
    workspaceName: workspace.name,
    admins: adminsOf(view.data?.people ?? []),
  });
  return (
    <PeerCard aria-label={words.title} className="items-center text-center">
      <h3 className="text-sm font-semibold text-foreground">{words.title}</h3>
      <p className="text-xs leading-relaxed text-muted-foreground">{words.text}</p>
      {view.error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {view.error}
        </p>
      )}
    </PeerCard>
  );
}
