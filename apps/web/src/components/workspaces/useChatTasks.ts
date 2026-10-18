import { usePrimaryEnvironment } from "../../state/environments";
import { chatTaskIndex, type ChatTaskIndex } from "../Sidebar.chats.logic";
import { usePeerHubStatus } from "./WorkspaceAccess";

/**
 * The Hub's tasks as the Chats rows name them (`‹task key› · …`): null until this computer has a
 * Hub status, and for people who are in no workspace. It reads the status the sidebar already
 * follows, not the whole Work tree.
 */
export function useChatTaskIndex(): ChatTaskIndex | null {
  const primary = usePrimaryEnvironment();
  const status = usePeerHubStatus(
    primary !== null && primary.connection.phase === "connected" ? primary.environmentId : null,
  );
  return chatTaskIndex(status);
}
