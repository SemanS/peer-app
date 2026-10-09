import type { PeerMobilePlugin } from "../slotTypes";
import { GitHubTaskBadge } from "./GitHubTaskBadge";
import { GitHubTaskPullRequests } from "./GitHubTaskPullRequests";
export const githubMobilePlugin: PeerMobilePlugin = {
  id: "github",
  taskBadges: GitHubTaskBadge,
  taskSections: GitHubTaskPullRequests,
};
