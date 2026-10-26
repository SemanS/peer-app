import type { EnvironmentId, PeerInvitePreview } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useState } from "react";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";

export function useInvitePreviews(
  environmentId: EnvironmentId,
  workspace: string,
  emails: ReadonlyArray<string>,
): ReadonlyArray<PeerInvitePreview> {
  const ask = useAtomCommand(serverEnvironment.peerHubInvitePreview, { reportFailure: false });
  const addresses = emails.join(",");
  const key = JSON.stringify([environmentId, workspace, addresses]);
  const [result, setResult] = useState<{
    key: string;
    previews: ReadonlyArray<PeerInvitePreview>;
  } | null>(null);
  const read = useEffectEvent((requestKey: string, current: () => boolean) => {
    void Promise.all(
      emails.map((email) => ask({ environmentId, input: { workspace, email } })),
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
