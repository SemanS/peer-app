import { localCoordination } from "@t3tools/client-runtime/peer/local";
import { PEER_LOCAL_WORKSPACE, type PeerHubStatus } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "../ui/button";
import { openHubSignIn } from "./HubSignInDialog";
import { useOpenPeerSettings } from "./settings/peerSettingsLinks";

/** The same local evidence appears in the sidebar and on the work board. */
export function LocalWork({ status }: { readonly status: PeerHubStatus }) {
  const local = localCoordination(status);
  const settings = useOpenPeerSettings();
  const navigate = useNavigate();
  const [shown, setShown] = useState(20);
  return (
    <section aria-label="Local coordination" className="flex flex-col gap-3 px-2 text-sm">
      <h2 className="font-semibold">{local.title}</h2>
      <p className="text-muted-foreground">{local.description}</p>
      {local.available ? (
        <>
          <p>
            {local.sessions.length} agents · {local.open} open overlaps · {local.resolved} resolved
          </p>
          <p className="text-xs text-muted-foreground">
            {local.providers
              .map(
                (provider) =>
                  `${provider.name}: ${provider.ready ? "hooks ready" : "setup needed or paused"}`,
              )
              .join(" · ")}
          </p>
          <p className="text-xs text-muted-foreground">
            Other providers can run chats; edit coordination requires a supported hook or MCP
            adapter.
          </p>
          {local.overlaps.slice(0, 8).map((overlap) => (
            <details key={overlap.id} className="rounded-md border p-3">
              <summary className="cursor-pointer font-medium">
                {overlap.state === "open" ? "Overlap detected" : "Overlap resolved"} ·{" "}
                {overlap.files.join(", ")}
              </summary>
              <div className="mt-2 flex flex-col gap-2 text-xs">
                <p>
                  {overlap.sessions
                    .map((id) => local.sessions.find((s) => s.id === id)?.label ?? id)
                    .join(" ↔ ")}
                </p>
                {overlap.resolution === undefined ? null : <p>{overlap.resolution}</p>}
                {overlap.notes.slice(-3).map((note) => (
                  <p key={note.id}>{note.text}</p>
                ))}
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    void navigate({
                      to: "/overlap/$workspace/$project/$overlap",
                      params: {
                        workspace: overlap.workspace,
                        project: overlap.project,
                        overlap: overlap.id,
                      },
                    })
                  }
                >
                  Open coordination
                </Button>
              </div>
            </details>
          ))}
          {local.overlaps.length === 0 ? (
            <p className="text-muted-foreground">
              No overlaps recorded yet. Open a repository and start agents with Peer hooks enabled.
            </p>
          ) : null}
        </>
      ) : null}
      {local.projects.length === 0 ? null : (
        <section aria-label="Local shared contexts" className="flex flex-col gap-2">
          <h3 className="font-medium">
            Shared contexts · {local.projects.length}{" "}
            {local.projects.length === 1 ? "project" : "projects"}
          </h3>
          {local.projects.slice(0, shown).map((project) => (
            <div key={project.id} className="flex flex-col gap-1">
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void navigate({
                      to: "/context/$workspace/$project/$scope",
                      params: {
                        workspace: PEER_LOCAL_WORKSPACE,
                        project: project.id,
                        scope: "project-aggregate",
                      },
                      search: {},
                    })
                  }
                >
                  Shared contexts and archive
                  {local.projects.length === 1 ? "" : ` · ${project.id.slice(-6)}`}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {project.contexts} saved contexts
                {project.gist === undefined ? "" : ` · ${project.gist}`}
              </p>
            </div>
          ))}
          {shown >= local.projects.length ? null : (
            <div>
              <Button size="xs" variant="outline" onClick={() => setShown(shown + 20)}>
                More projects · {local.projects.length - shown}
              </Button>
            </div>
          )}
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="xs"
          variant="outline"
          onClick={() => void settings({ kind: "computer", section: "coordination" })}
        >
          Coordination settings
        </Button>
        {!status.signedIn ? (
          <Button size="xs" variant="ghost-muted" onClick={openHubSignIn}>
            Connect a team Hub
          </Button>
        ) : null}
      </div>
    </section>
  );
}
