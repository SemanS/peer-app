import type { PeerDigest } from "@t3tools/contracts";
import { coverageNotice } from "@t3tools/client-runtime/peer-digest";
import { useNavigate } from "@tanstack/react-router";
import { useOpenLink } from "../../../browser/useOpenLink";
import { Button } from "../../ui/button";
import { digestViewRows } from "./digest.logic";
export function DigestCard({
  digest,
  title,
  workspace,
  project,
  who,
  onDismiss,
}: {
  digest: PeerDigest;
  title: string;
  workspace: string;
  project: string;
  who: (email: string) => string;
  onDismiss: () => void;
}) {
  const navigate = useNavigate(),
    openLink = useOpenLink(null);
  return (
    <section className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium">{title}</h4>
        <Button size="xs" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {digest.since} – {digest.until}
      </p>
      {coverageNotice(digest.coverage) ? (
        <p className="text-xs text-muted-foreground">{coverageNotice(digest.coverage)}</p>
      ) : null}
      {digest.unavailable?.length ? (
        <p className="text-xs text-muted-foreground">
          Some sources are unavailable: {digest.unavailable.join(", ")}
        </p>
      ) : null}
      {digestViewRows(digest, who).map((section) => (
        <div key={section.id} className="space-y-1">
          <h5 className="text-xs font-medium">
            {section.title} ({section.total})
          </h5>
          {section.rows.map((row) => (
            <div key={row.key}>
              {row.target ? (
                <button
                  type="button"
                  className="text-left text-xs underline-offset-4 hover:underline"
                  onClick={() => {
                    const target = row.target;
                    if (target?.kind === "url") void openLink(target.url);
                    else if (target?.kind === "context")
                      void navigate({
                        to: "/context/$workspace/$project/$scope",
                        params: { workspace, project, scope: target.scope },
                      });
                    else if (target?.kind === "knowledge")
                      void navigate({
                        to: "/knowledge/$workspace/$project",
                        params: { workspace, project },
                      });
                  }}
                >
                  {row.text}
                </button>
              ) : (
                <p className="text-xs">{row.text}</p>
              )}
              <p className="text-3xs text-muted-foreground">{row.at}</p>
              {row.note ? <p className="text-xs text-muted-foreground">{row.note}</p> : null}
            </div>
          ))}
          {section.remaining ? (
            <p className="text-xs text-muted-foreground">+{section.remaining} more</p>
          ) : null}
        </div>
      ))}
    </section>
  );
}
