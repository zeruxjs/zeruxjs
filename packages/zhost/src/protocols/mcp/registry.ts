import type { McpTool, McpResource } from './types.js';
import { validateArguments } from './schema.js';
/** Explicit trusted tool definitions; schema validation and application authorization remain distinct. */
export class ToolRegistry {
  /** Trusted mutable host definitions retained until explicit unregister or registry release. */
  private tools = new Map<string, McpTool>();
  /** Register explicitly trusted tool code or inert resource data; this registry does not authorize remote callers or freeze host definitions.
   * @param {McpTool} tool - Trusted named callback/schema definition, retained by reference; duplicate tool names reject.
   * @returns {void} Changes only this application-local registry; no transport, URL fetch or package discovery starts.
   */
  register(tool: McpTool): void {
    if (
      !tool ||
      !/^[\w.-]{1,128}$/.test(tool.name) ||
      typeof tool.handler !== 'function'
    ) {
      throw new TypeError('Invalid tool');
    }
    if (this.tools.has(tool.name)) {
      throw new Error('Duplicate MCP tool');
    }
    this.tools.set(tool.name, tool);
  }
  /** Remove one explicit tool registration without invoking its callback.
   * @param {string} name - Exact registered tool name.
   * @returns {boolean} Whether a registration was removed.
   */
  unregister(name: string) {
    return this.tools.delete(name);
  }
  /** Return new outer metadata records without tool handlers or resource text; tool schemas and any nested host metadata remain borrowed.
   * @returns {object[]} Current registration-order metadata, not a general deep-copy or secret-redaction guarantee.
   */
  list() {
    return [...this.tools.values()].map(
      ({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema: inputSchema ?? { type: 'object', properties: {} },
      })
    );
  }
  /** Select trusted tool code by exact name and apply the supported shallow argument checks before invoking it.
   * @param {string} name - Exact explicit tool name.
   * @param {Record<string, unknown>} args - Inert object arguments, defaulting to an empty record.
   * @param {import('../json-rpc.js').RpcContext} context - Host-authorized context; the callback owns fine-grained permission, cooperative cancellation and side-effect policy.
   * @returns {Promise<unknown>} Trusted callback result; unknown tools, invalid arguments and handler failures reject without automatic replay.
   */
  async call(
    name: string,
    args: Record<string, unknown> = {},
    context: import('../json-rpc.js').RpcContext = {}
  ): Promise<unknown> {
    /** Explicitly registered trusted definition; the registry never synthesizes executable code from arguments. */
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown MCP tool: ${name}`);
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw new TypeError('Tool arguments must be an object');
    }
    validateArguments(tool.inputSchema, args);
    return tool.handler(args, context);
  }
}
/** Create an inert application-local explicit tool registry without timers or network resources.
 * @returns {ToolRegistry} Trusted registrations remain host-owned; no model-supplied code or URLs are executed.
 */
export function createMcpToolRegistry() {
  return new ToolRegistry();
}
/** Inert registered text resources; URI keys are never resolved as remote URLs or local paths. */
export class ResourceRegistry {
  /** Shallow resource snapshots owned by this registry, without background transport handles. */
  private resources = new Map<string, McpResource>();
  /** Register explicitly trusted tool code or inert resource data; this registry does not authorize remote callers or freeze host definitions.
   * @param {McpResource} resource - Trusted named text resource; the existing registry replaces its URI key with a shallow copy.
   * @returns {void} Changes only this application-local registry; no transport, URL fetch or package discovery starts.
   */
  register(resource: McpResource): void {
    if (!resource?.uri || !resource.name || typeof resource.text !== 'string') {
      throw new TypeError('Invalid MCP resource');
    }
    this.resources.set(resource.uri, { ...resource });
  }
  /** Remove one inert resource registration by exact key, without fetching or deleting an external object.
   * @param {string} uri - Exact registered resource URI, treated only as a lookup key.
   * @returns {boolean} Whether the local record was removed.
   */
  remove(uri: string) {
    return this.resources.delete(uri);
  }
  /** Return new outer metadata records without tool handlers or resource text; tool schemas and any nested host metadata remain borrowed.
   * @returns {object[]} Current registration-order metadata, not a general deep-copy or secret-redaction guarantee.
   */
  list() {
    return [...this.resources.values()].map(
      ({ text: _text, ...metadata }) => metadata
    );
  }
  /** Read a shallow copy of an explicitly registered text resource; URI schemes never trigger filesystem/network access.
   * @param {string} uri - Exact local registry key; host authorization must precede access.
   * @returns {McpResource} Registered inert data; unknown keys throw.
   */
  read(uri: string) {
    /** Stored inert resource selected by exact key and copied before returning. */
    const value = this.resources.get(uri);
    if (!value) {
      throw new Error('Resource not found');
    }
    return { ...value };
  }
}
