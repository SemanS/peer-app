import type { ProjectId } from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { useScratchProject } from "../../../../hooks/useScratchProject";
import { useProjects } from "../../../../state/entities";
import { serverEnvironment } from "../../../../state/server";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { Button } from "../../../ui/button";
import { Input } from "../../../ui/input";
import { Spinner } from "../../../ui/spinner";
import { Switch } from "../../../ui/switch";
import { PeerStackedField } from "../../PeerDialog";
import { selectLocalProjects } from "../../localProjects.logic";
import { useSwitchToJujutsu } from "../../useOpenWorkspaceProject";
import { failureMessage } from "../../WorkspaceAccess";
import { reportFailure } from "../../workFeedback";
import {
  ID_PLACEHOLDER,
  checkoutBinding,
  chipsFor,
  createOperation,
  nameProblem,
  projectIdFromName,
  readyToCreate,
  repositoryChoices,
  repositoryProblem,
  takenProjectIds,
  type RepositoryChoice,
} from "../newProject.logic";
import { LocalRepositories, PersonChip } from "../NewProjectParts";
import type { WorkspacePageProps } from "../pageProps";
import { useOpenPeerSettings, PeerSettingsRedirect } from "../peerSettingsLinks";
import { PeerSettingsPage } from "../PeerSettingsPage";
import { DESCRIPTION_MAX } from "../projectBasics.logic";
import { jjBlocked } from "../projectRepositories.logic";
import { AddPeoplePanel, WhoSwitch } from "../ProjectPeopleParts";
import { addPeople, type WhoMode } from "../projectPeople.logic";
import { isWorkspaceAdmin } from "../peerSettings.logic";
import { SettingsUnavailableNote } from "../SettingsUnavailable";
import { useReviewChanges } from "../useReviewChanges";
import { useSettingsView } from "../useSettingsView";

const Optional = () => <span className="font-normal text-muted-foreground">optional</span>;

/**
 * Starting a project (design artboard 06): a name that makes its id, who the work is for, who is on
 * it, and a repository to begin with, which may be a checkout already open on this computer: this
 * computer then works in it, and does not clone the repository again. Creating goes through the
 * review like any save, with the person as the project's lead; once it is saved and this computer
 * has it, the page opens its Basics. Against a Hub that cannot change settings, the way before the
 * settings area stands.
 */
export function NewProject({ environmentId, status, workspace }: WorkspacePageProps) {
  const view = useSettingsView(workspace.slug);
  const open = useOpenPeerSettings();
  const sync = useAtomCommand(serverEnvironment.peerHubSync, { reportFailure: false });
  const openProject = useAtomCommand(serverEnvironment.peerHubOpenProject, {
    reportFailure: false,
  });
  const jujutsu = useSwitchToJujutsu(environmentId);
  const bindCheckout = useAtomCommand(serverEnvironment.peerHubBindCheckout, {
    reportFailure: false,
  });
  const projects = useProjects();
  const { scratchWorkspaceRootFor } = useScratchProject();
  const formId = useId();
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [description, setDescription] = useState("");
  const [who, setWho] = useState<WhoMode>("selected");
  const [chosen, setChosen] = useState<ReadonlyArray<string>>([]);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");
  // The checkout open here that the person picked, which the address they typed may have left.
  const [picked, setPicked] = useState<RepositoryChoice<ProjectId> | null>(null);
  const [useJj, setUseJj] = useState(false);
  const jjStopped = jjBlocked(status.jj);
  const offerJj = jujutsu.allowed && url.trim() !== "";
  // The clone waits for the project to reach this computer, and the page waits for both.
  const [jjSettled, setJjSettled] = useState(false);
  const jjStarted = useRef(false);
  const [created, setCreated] = useState<{ readonly id: string; readonly name: string } | null>(
    null,
  );
  // Whether this computer has fetched the saved project yet: it lists it once the Hub's ping is
  // answered, and until then the page waits rather than opening a project it cannot find.
  const [fetched, setFetched] = useState<"running" | "done" | { readonly error: string }>(
    "running",
  );

  const id = projectIdFromName(name);
  const taken = takenProjectIds(
    view.document,
    workspace.projects.map((state) => state.project.id),
  );
  const problem = nameProblem({ name, id, taken });
  const repository = { url, branch };
  const repoProblem = repositoryProblem(repository);
  const me = view.me;
  const read =
    view.hubHasSettings && view.revision !== null && view.document !== null && me !== null;
  const ready = readyToCreate({
    name,
    nameProblem: problem,
    description,
    repositoryProblem: repoProblem,
    read,
  });

  const syncNow = () => {
    setFetched("running");
    void sync({ environmentId, input: {} }).then((result) => {
      const failure = failureMessage(result);
      setFetched(failure === null ? "done" : { error: failure });
    });
  };
  // The project exists whether or not its checkout could be bound: if not, this computer clones the
  // repository as for any project, and the person is told.
  const bind = async () => {
    const binding = checkoutBinding({ workspace: workspace.slug, id, repository, picked });
    if (binding === null) return;
    reportFailure(
      "Could not use the project open on this computer",
      await bindCheckout({ environmentId, input: binding }),
    );
  };
  const review = useReviewChanges({
    scope: name.trim(),
    onSaved: () => {
      setCreated({ id, name: name.trim() });
      view.refresh();
      // Bound before this computer fetches the project, so it finds the checkout already there.
      void bind().then(syncNow);
    },
  });

  const sharedProjectIds = new Set(
    status.workspaces.flatMap((entry) =>
      entry.projects.flatMap((project) =>
        project.repositories.flatMap((repo) => (repo.projectId ? [repo.projectId] : [])),
      ),
    ),
  );
  const choices = repositoryChoices(
    selectLocalProjects(
      projects,
      environmentId,
      scratchWorkspaceRootFor(environmentId),
      sharedProjectIds,
    ),
  );
  const chips =
    me === null ? [] : chipsFor(me, chosen, view.people, (person) => view.nameOf(person));

  const create = () => {
    if (!ready || view.revision === null || me === null) return;
    review.open(
      createOperation({
        workspace: workspace.slug,
        base: view.revision,
        id,
        project: { name, client, description, who, people: chosen, repository, me },
      }),
      { scope: name.trim(), context: "Creating a project. You become its lead." },
    );
  };

  const arrived =
    created !== null && workspace.projects.some((state) => state.project.id === created.id);
  const switching = arrived && useJj && offerJj && jjStopped === null;
  const switchTo = jujutsu.switchTo;
  useEffect(() => {
    if (!switching || created === null || jjStarted.current) return;
    jjStarted.current = true;
    const input = { workspace: workspace.slug, projectId: created.id };
    void openProject({ environmentId, input })
      .then(async (result) => {
        const failure = failureMessage(result);
        if (failure === null) await switchTo(input);
        else reportFailure("Could not clone the project", result);
      })
      .finally(() => setJjSettled(true));
  }, [created, environmentId, openProject, switchTo, switching, workspace.slug]);

  const header = {
    title: "New project",
    description:
      "You become its lead. Areas, tools, capacity and coordination come after, in its settings.",
  };

  if (!view.hubHasSettings) {
    return (
      <PeerSettingsPage {...header}>
        <div className="flex max-w-2xl flex-col gap-2">
          <SettingsUnavailableNote />
          <p className="text-sm text-muted-foreground">
            {isWorkspaceAdmin(workspace.role) ? (
              <>
                Declare projects in the workspace configuration and apply it with{" "}
                <code className="font-mono text-foreground">peerhub workspace apply</code>.
              </>
            ) : (
              "The workspace lists the projects you are on in the sidebar. Ask a lead to add you to another."
            )}
          </p>
        </div>
      </PeerSettingsPage>
    );
  }

  // The project is saved: wait for this computer to have it, then open it.
  if (created !== null && review.dialog === null) {
    if (switching && !jjSettled) {
      return (
        <PeerSettingsPage {...header}>
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner size="sm" />
            Cloning {created.name} and adding Jujutsu…
          </p>
        </PeerSettingsPage>
      );
    }
    if (arrived) {
      return (
        <PeerSettingsRedirect
          to={{ kind: "project", workspace: workspace.slug, projectId: created.id, tab: "basics" }}
        />
      );
    }
    return (
      <PeerSettingsPage {...header}>
        <div role="status" className="flex max-w-2xl flex-col items-start gap-2">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {fetched === "running" ? <Spinner size="sm" /> : null}
            {fetched === "running"
              ? `Opening ${created.name}…`
              : typeof fetched === "object"
                ? `${created.name} is saved, but this computer could not fetch it yet: ${fetched.error}`
                : `${created.name} is saved. It opens here once this computer has fetched it.`}
          </p>
          {fetched === "running" ? null : (
            <Button size="sm" variant="outline" onClick={syncNow}>
              Sync now
            </Button>
          )}
        </div>
      </PeerSettingsPage>
    );
  }

  return (
    <PeerSettingsPage {...header}>
      <form
        id={formId}
        aria-label="New project"
        className="flex max-w-2xl flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <SettingsUnavailableNote />
        {view.error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {view.error}
          </p>
        )}
        <PeerStackedField label="Name" htmlFor={`${formId}-name`}>
          <Input
            id={`${formId}-name`}
            autoFocus
            autoComplete="off"
            size="lg"
            placeholder="Booking"
            value={name}
            aria-invalid={problem === null ? undefined : true}
            onChange={(event) => setName(event.target.value)}
          />
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            ID <code className="font-mono text-foreground">{id === "" ? ID_PLACEHOLDER : id}</code>
            {" · can’t change after you create it"}
          </span>
          {problem === null ? null : (
            <p role="alert" className="text-xs text-warning-foreground">
              {problem.text}
            </p>
          )}
        </PeerStackedField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3.5">
          <PeerStackedField
            label={
              <>
                Client <Optional />
              </>
            }
            htmlFor={`${formId}-client`}
          >
            <Input
              id={`${formId}-client`}
              autoComplete="off"
              placeholder="Who the work is for"
              value={client}
              onChange={(event) => setClient(event.target.value)}
            />
          </PeerStackedField>
          <PeerStackedField
            label={
              <>
                Description <Optional />
              </>
            }
            htmlFor={`${formId}-description`}
          >
            <Input
              id={`${formId}-description`}
              placeholder="One line, up to 300 characters"
              maxLength={DESCRIPTION_MAX}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </PeerStackedField>
        </div>

        <div role="group" aria-labelledby={`${formId}-who`} className="flex flex-col gap-2">
          <span id={`${formId}-who`} className="text-sm font-medium text-foreground">
            Who’s on it
          </span>
          <WhoSwitch
            label="Who’s on it"
            mode={who}
            onChange={(mode) => {
              setWho(mode);
              setAdding(false);
            }}
          />
          {who === "all" ? (
            <p className="text-xs text-muted-foreground">
              Everyone in {workspace.name} sees it, and new members join automatically.
            </p>
          ) : (
            <>
              <ul
                aria-label="People on the project"
                className="flex flex-wrap items-center gap-1.5"
              >
                {chips.map((chip) => (
                  <li key={chip.email}>
                    <PersonChip
                      chip={chip}
                      onRemove={(email) =>
                        setChosen((current) => current.filter((address) => address !== email))
                      }
                    />
                  </li>
                ))}
                <li>
                  <Button
                    size="xs"
                    variant="outline"
                    aria-expanded={adding}
                    onClick={() => setAdding(!adding)}
                  >
                    <PlusIcon aria-hidden />
                    Add people
                  </Button>
                </li>
              </ul>
              {adding ? (
                <AddPeoplePanel
                  workspaceName={workspace.name}
                  people={view.people}
                  taken={me === null ? chosen : [me, ...chosen]}
                  onAdd={(email) => setChosen((current) => addPeople(current, [email]))}
                  onOpenPeople={() =>
                    void open({ kind: "workspace", workspace: workspace.slug, section: "people" })
                  }
                />
              ) : null}
            </>
          )}
        </div>

        <div role="group" aria-labelledby={`${formId}-repository`} className="flex flex-col gap-2">
          <span id={`${formId}-repository`} className="text-sm font-medium text-foreground">
            Repository <Optional />
          </span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
            <Input
              font="mono"
              aria-label="Repository URL"
              placeholder="https://github.com/acme/booking-api"
              autoCapitalize="none"
              spellCheck={false}
              value={url}
              aria-invalid={repoProblem?.field === "url" ? true : undefined}
              onChange={(event) => setUrl(event.target.value)}
            />
            <Input
              font="mono"
              aria-label="Branch"
              placeholder="main"
              autoCapitalize="none"
              spellCheck={false}
              value={branch}
              aria-invalid={repoProblem?.field === "branch" ? true : undefined}
              onChange={(event) => setBranch(event.target.value)}
            />
          </div>
          {repoProblem === null ? null : (
            <p role="alert" className="text-xs text-destructive-foreground">
              {repoProblem.text}
            </p>
          )}
          <LocalRepositories
            choices={choices}
            onPick={(choice) => {
              setUrl(choice.url);
              setPicked(choice);
            }}
          />
          {offerJj ? (
            <div className="flex items-start gap-2.5 pt-1">
              <Switch
                aria-labelledby={`${formId}-jj`}
                checked={useJj && jjStopped === null}
                disabled={jjStopped !== null}
                onCheckedChange={setUseJj}
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span id={`${formId}-jj`} className="text-sm text-foreground">
                  Use Jujutsu
                </span>
                <span className="text-xs text-muted-foreground">
                  {jjStopped ??
                    "Brings the repository to this computer now and adds Jujutsu beside Git. .git and its remotes stay."}
                </span>
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button type="submit" disabled={!ready}>
            Create project
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              void open({ kind: "workspace", workspace: workspace.slug, section: "general" })
            }
          >
            Cancel
          </Button>
        </div>
      </form>
      {review.dialog}
    </PeerSettingsPage>
  );
}
