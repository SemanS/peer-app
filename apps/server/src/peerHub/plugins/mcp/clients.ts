/**
 * The editors and agents that can connect Peer's MCP server, as data: adding one is one entry.
 *
 * Claude Code and Codex are not here: they coordinate through Peer hooks and need no MCP entry.
 * Paths are segments under a base, so tests resolve them against a temporary home.
 */

/** `home` is `~`; `config` is the platform's per-user settings folder; `root` the project. */
export type McpBase = "home" | "config" | "root";

export interface McpFile {
  readonly base: McpBase;
  readonly path: ReadonlyArray<string>;
  /** The object in the file that holds named servers. */
  readonly key: string;
}

/** How an entry looks in a client's file; `entryOf` writes each. */
export type McpEntryFormat = "stdio" | "vscode" | "opencode" | "zed" | "copilot";

export interface McpClientDefinition {
  readonly id: string;
  readonly title: string;
  /** Any of these existing tells that the client is on this computer. */
  readonly detect: ReadonlyArray<{ readonly base: McpBase; readonly path: ReadonlyArray<string> }>;
  readonly format: McpEntryFormat;
  readonly user?: McpFile;
  readonly project?: McpFile;
}

export const MCP_SERVER_NAME = "peer";

export const MCP_CLIENTS: ReadonlyArray<McpClientDefinition> = [
  {
    id: "cursor",
    title: "Cursor",
    detect: [{ base: "home", path: [".cursor"] }],
    format: "stdio",
    user: { base: "home", path: [".cursor", "mcp.json"], key: "mcpServers" },
    project: { base: "root", path: [".cursor", "mcp.json"], key: "mcpServers" },
  },
  {
    id: "vscode",
    title: "VS Code (GitHub Copilot)",
    detect: [{ base: "config", path: ["Code", "User"] }],
    format: "vscode",
    user: { base: "config", path: ["Code", "User", "mcp.json"], key: "servers" },
    project: { base: "root", path: [".vscode", "mcp.json"], key: "servers" },
  },
  {
    id: "windsurf",
    title: "Windsurf",
    detect: [{ base: "home", path: [".codeium", "windsurf"] }],
    format: "stdio",
    user: { base: "home", path: [".codeium", "windsurf", "mcp_config.json"], key: "mcpServers" },
  },
  {
    id: "gemini",
    title: "Gemini CLI",
    detect: [{ base: "home", path: [".gemini"] }],
    format: "stdio",
    user: { base: "home", path: [".gemini", "settings.json"], key: "mcpServers" },
    project: { base: "root", path: [".gemini", "settings.json"], key: "mcpServers" },
  },
  {
    id: "opencode",
    title: "OpenCode",
    detect: [{ base: "home", path: [".config", "opencode"] }],
    format: "opencode",
    user: { base: "home", path: [".config", "opencode", "opencode.json"], key: "mcp" },
    project: { base: "root", path: ["opencode.json"], key: "mcp" },
  },
  {
    id: "zed",
    title: "Zed",
    detect: [{ base: "home", path: [".config", "zed"] }],
    format: "zed",
    user: { base: "home", path: [".config", "zed", "settings.json"], key: "context_servers" },
  },
  {
    id: "copilot-cli",
    title: "GitHub Copilot CLI",
    detect: [{ base: "home", path: [".copilot"] }],
    format: "copilot",
    user: { base: "home", path: [".copilot", "mcp-config.json"], key: "mcpServers" },
  },
  {
    id: "kiro",
    title: "Kiro",
    detect: [{ base: "home", path: [".kiro"] }],
    format: "stdio",
    user: { base: "home", path: [".kiro", "settings", "mcp.json"], key: "mcpServers" },
    project: { base: "root", path: [".kiro", "settings", "mcp.json"], key: "mcpServers" },
  },
];

export interface McpServerCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string>>;
}

/** The `peer` entry in a client's own shape; an empty env is left out. */
export function entryOf(format: McpEntryFormat, server: McpServerCommand): Record<string, unknown> {
  const env = server.env !== undefined && Object.keys(server.env).length > 0 ? server.env : null;
  const args = [...server.args];
  switch (format) {
    case "stdio":
      return { command: server.command, args, ...(env ? { env } : {}) };
    case "vscode":
      return { type: "stdio", command: server.command, args, ...(env ? { env } : {}) };
    case "opencode":
      return {
        type: "local",
        command: [server.command, ...args],
        enabled: true,
        ...(env ? { environment: env } : {}),
      };
    case "zed":
      return { source: "custom", command: server.command, args, ...(env ? { env } : {}) };
    case "copilot":
      return {
        type: "local",
        command: server.command,
        args,
        tools: ["*"],
        ...(env ? { env } : {}),
      };
  }
}

export const mcpClient = (id: string) => MCP_CLIENTS.find((client) => client.id === id);
