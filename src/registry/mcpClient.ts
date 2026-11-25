/**
 * JSON-RPC 2.0 client for the hosted Agent Registry MCP service.
 *
 * Reference: docs.concordium.com/en/mainnet/technical-reference/agent-registry/mcp-service.html
 *  - MCP endpoint: https://agent-registry-mcp.concordium.com/mcp (JSON-RPC 2.0)
 *  - The service holds NO private keys. Builder tools return a sign-ready
 *    payload ({ hex, schema_json }) that the caller's wallet must sign and
 *    submit — see registry/register.ts.
 *  - 41 tools are exposed (verified via `tools/list`, 25 Nov 2026);
 *    `tools/list` returns every tool with its input schema.
 *
 * Protocol notes (verified live against the hosted service, 25 Nov 2026):
 *  - The server answers `initialize` with protocolVersion "2024-11-05" and
 *    serverInfo { name: "concordium-agent-registry-mcp", version: "0.1.0" }.
 *  - It is effectively stateless (no session id is issued), but this client
 *    still performs the standard initialize → notifications/initialized
 *    handshake once, lazily, and tolerates its failure.
 *  - Tool results come back as MCP content parts:
 *    result.content[0] = { type: "text", text: "<JSON string>" } — the text
 *    must be JSON.parsed to get the tool payload. `result.isError` marks
 *    tool-level failures.
 */

export interface ContractAddress {
  index: number;
  subindex: number;
}

/** Payload of the MCP `contract_info` tool (verified live, 25 Nov 2026). */
export interface ContractInfo {
  network: string;
  network_name: string;
  cis8004_contract: ContractAddress;
  cis8004_module_ref: string;
  cis8004_admin: string;
  cis8_contract: ContractAddress;
  cis8_module_ref: string;
  supported_standards: string[];
  explorer_base: string;
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: string;
  id?: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface McpToolCallResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export class AgentRegistryMcpClient {
  private nextId = 1;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly baseUrl: string) {}

  private endpoint(): string {
    return `${this.baseUrl.replace(/\/$/, "")}/mcp`;
  }

  /** One raw JSON-RPC round-trip. Handles plain-JSON and SSE-framed replies. */
  private async rpc<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(this.endpoint(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.nextId++,
        method,
        ...(params !== undefined ? { params } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`MCP ${method} failed: HTTP ${res.status}`);
    }
    const text = await res.text();
    // Streamable-HTTP servers may answer with an SSE frame even when JSON was
    // accepted; extract the JSON payload from the last `data:` line then.
    const trimmed = text.trim();
    const payload = trimmed.startsWith("{")
      ? trimmed
      : (trimmed
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice("data:".length).trim())
          .pop() ?? trimmed);
    const body = JSON.parse(payload) as JsonRpcResponse<T>;
    if (body.error) {
      throw new Error(
        `MCP ${method} error ${body.error.code}: ${body.error.message}`,
      );
    }
    return body.result as T;
  }

  /** Fire-and-forget JSON-RPC notification (no id, no response body needed). */
  private async notify(method: string): Promise<void> {
    await fetch(this.endpoint(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method }),
    }).catch(() => undefined);
  }

  /** Lazy one-time MCP handshake; failures are tolerated (server is stateless). */
  private ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        try {
          await this.rpc("initialize", {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "scout-agent", version: "0.1.0" },
          });
          await this.notify("notifications/initialized");
        } catch {
          // The hosted service also answers tools/call without a handshake;
          // do not let a handshake hiccup block read-only tool calls.
        }
      })();
    }
    return this.initPromise;
  }

  /**
   * Call one MCP tool by name and return its parsed payload.
   * Tool names are the snake_case names from `tools/list`.
   */
  async callTool<T = unknown>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    await this.ensureInitialized();
    const result = await this.rpc<McpToolCallResult>("tools/call", {
      name,
      arguments: args,
    });
    const textPart = result?.content?.find((c) => c.type === "text")?.text;
    if (result?.isError) {
      throw new Error(`MCP tool ${name} returned an error: ${textPart ?? "(no detail)"}`);
    }
    if (textPart === undefined) {
      return result as T;
    }
    try {
      return JSON.parse(textPart) as T;
    } catch {
      return textPart as T;
    }
  }

  /** Sanity check: GET /healthz on the hosted service → { ok, version }. */
  async healthz(): Promise<boolean> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/healthz`);
    return res.ok;
  }

  /**
   * Discover the CIS-8004 / CIS-8 contract addresses for a network.
   * MCP tool: `contract_info` — returns contract addresses, module references
   * and admin accounts for both CIS-8004 and CIS-8 on a given network.
   * This is how the TESTNET registry indices are obtained (not in the docs).
   */
  async contractInfo(network: string): Promise<ContractInfo> {
    return this.callTool<ContractInfo>("contract_info", { network });
  }

  /** MCP tool: `network_status` — gRPC endpoint, latest finalised block, Indexer sync state. */
  async networkStatus(network: string) {
    return this.callTool("network_status", { network });
  }
}
