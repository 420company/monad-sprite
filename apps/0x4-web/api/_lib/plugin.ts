/**
 * MCP-inspired plugin system for the Sprite agent.
 *
 * Each plugin declares its tools (OpenAI function schemas) and executes them.
 * Add a new capability by creating a plugin file and registering it —
 * no changes to agentCore.ts needed.
 *
 * Future: load plugins dynamically from a manifest / remote MCP servers.
 */
import type { ToolDef } from './router.js';

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  /** Unsigned tx for the frontend to sign (trading plugins). */
  tx?: { to: string; data: string; value: string; description: string };
  error?: string;
}

export interface PluginContext {
  wallet?: string;
}

export interface AgentPlugin {
  /** Unique plugin id, e.g. "monad-trading" */
  name: string;
  version: string;
  description: string;
  /** Tool schemas exposed to the LLM */
  tools: ToolDef[];
  /** Execute one of this plugin's tools */
  execute(toolName: string, args: Record<string, unknown>, ctx?: PluginContext): Promise<ToolResult>;
}

class PluginRegistry {
  private plugins = new Map<string, AgentPlugin>();
  private toolToPlugin = new Map<string, string>();

  register(plugin: AgentPlugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin already registered: ${plugin.name}`);
    }
    this.plugins.set(plugin.name, plugin);
    for (const t of plugin.tools) {
      const toolName = t.function.name;
      if (this.toolToPlugin.has(toolName)) {
        throw new Error(`Tool name conflict: ${toolName} (from ${plugin.name})`);
      }
      this.toolToPlugin.set(toolName, plugin.name);
    }
  }

  /** All tool schemas across plugins — passed to the LLM */
  allTools(): ToolDef[] {
    return [...this.plugins.values()].flatMap((p) => p.tools);
  }

  async execute(toolName: string, args: Record<string, unknown>, ctx?: PluginContext): Promise<ToolResult> {
    const pluginName = this.toolToPlugin.get(toolName);
    if (!pluginName) return { ok: false, error: `Unknown tool: ${toolName}` };
    const plugin = this.plugins.get(pluginName)!;
    try {
      return await plugin.execute(toolName, args, ctx);
    } catch (e) {
      return { ok: false, error: `Plugin ${pluginName} error: ${(e as Error).message.slice(0, 300)}` };
    }
  }

  list(): Array<{ name: string; version: string; description: string; tools: string[] }> {
    return [...this.plugins.values()].map((p) => ({
      name: p.name,
      version: p.version,
      description: p.description,
      tools: p.tools.map((t) => t.function.name),
    }));
  }
}

export const registry = new PluginRegistry();
