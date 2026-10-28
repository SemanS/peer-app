import type { EnvironmentId, PeerInvitePreview } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useState } from "react";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";

/**
 * What inviting each address would reach, read a moment after the addresses settle. `projects` are
 * the ones the invitation names: a lead's preview must name them, and they change what it reaches.
 */
export function useInvitePreviews(
  environmentId: EnvironmentId,
  workspace: string,
  emails: ReadonlyArray<string>,
  projects: ReadonlyArray<string> = [],
): ReadonlyArray<PeerInvitePreview> {
  const ask = useAtomCommand(serverEnvironment.peerHubInvitePreview, { reportFailure: false });
  const addresses = emails.join(",");
  const named = projects.toSorted();
  const key = JSON.stringify([environmentId, workspace, addresses, named]);
  const [result, setResult] = useState<{
    key: string;
    previews: ReadonlyArray<PeerInvitePreview>;
  } | null>(null);
  const read = useEffectEvent((requestKey: string, current: () => boolean) => {
    void Promise.all(
      emails.map((email) =>
        ask({
          environmentId,
          input: { workspace, email, ...(named.length === 0 ? {} : { projects: named }) },
        }),
      ),
    ).then((answers) => {
      if (current())
        setResult({
          key: requestKey,
          previews: answers.flatMap((answer) =>
            answer._tag === "Success" && answer.value !== null ? [answer.value] : [],
          ),
        });
    });
  });
  useEffect(() => {
    if (addresses === "") return;
    let current = true;
    const timer = setTimeout(() => read(key, () => current), 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [addresses, key]);
  return result?.key === key ? result.previews : [];
}
