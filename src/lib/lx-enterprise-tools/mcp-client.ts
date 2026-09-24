import {
  LX_ENTERPRISE_PROTOCOL_VERSION,
  type LxEnterpriseRemoteToolConfig,
  type LxEnterpriseRemoteToolName,
} from "./constants";
import type { LxEnterpriseFetch, LxEnterpriseToolOutput } from "./types";
import { LxEnterpriseToolsError } from "./types";

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: string | number | null;
  result?: unknown;
  error?: unknown;
};

type McpToolResult = {
  content?: Array<{ type?: string; text?: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
};

export type CallLxMcpToolOptions = {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  platform: string;
  fetch: LxEnterpriseFetch;
  toolName: LxEnterpriseRemoteToolName;
  toolConfig: LxEnterpriseRemoteToolConfig;
  arguments: Record<string, unknown>;
  abortSignal?: AbortSignal;
};

type RequestContext = Pick<
  CallLxMcpToolOptions,
  "baseUrl" | "token" | "platform" | "fetch" | "toolConfig"
> & {
  signal: AbortSignal;
  nextRequestId: () => number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** SSE 的一个事件可以包含多行 data；逐事件合并后取首个有效 JSON。 */
const decodeEventStream = (body: string): JsonRpcResponse => {
  const normalized = body.replaceAll("\r\n", "\n");
  for (const event of normalized.split("\n\n")) {
    const data = event
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") continue;

    try {
      return JSON.parse(data) as JsonRpcResponse;
    } catch {
      throw new LxEnterpriseToolsError(
        "INVALID_RESPONSE",
        "灵犀服务返回了无法解析的响应。",
      );
    }
  }
  throw new LxEnterpriseToolsError(
    "INVALID_RESPONSE",
    "灵犀服务返回了无法解析的响应。",
  );
};

const decodeResponse = (body: string, contentType: string): JsonRpcResponse => {
  if (contentType.includes("text/event-stream")) {
    return decodeEventStream(body);
  }
  try {
    return JSON.parse(body) as JsonRpcResponse;
  } catch {
    throw new LxEnterpriseToolsError(
      "INVALID_RESPONSE",
      "灵犀服务返回了无法解析的响应。",
    );
  }
};

/** HTTP 状态只转换为安全提示，绝不拼接端点、请求头或远端正文。 */
const getHttpError = (status: number): LxEnterpriseToolsError => {
  if (status === 401 || status === 403) {
    return new LxEnterpriseToolsError(
      "AUTH_FAILED",
      "灵犀服务认证失败，请检查 LX_MCP_TOKEN。",
    );
  }
  if (status === 404) {
    return new LxEnterpriseToolsError(
      "ENDPOINT_NOT_FOUND",
      "灵犀 MCP 服务地址不可用。",
    );
  }
  if (status === 408 || status === 429 || status >= 500) {
    return new LxEnterpriseToolsError(
      "UPSTREAM_UNAVAILABLE",
      "灵犀查询服务暂时不可用，请稍后重试。",
    );
  }
  return new LxEnterpriseToolsError(
    "HTTP_ERROR",
    "灵犀 MCP 请求失败，请检查服务配置。",
  );
};

/**
 * 只识别服务端已知且可安全展示的协议诊断，不透传任意远端 message。
 * 灵犀使用 HTTP 200 包装 JSON-RPC 请求头错误，因此不能只依赖 HTTP 状态判断。
 */
const getJsonRpcError = (error: unknown): LxEnterpriseToolsError => {
  if (isRecord(error) && error.code === -32001 && typeof error.message === "string") {
    const normalizedMessage = error.message.toLowerCase();
    if (normalizedMessage.includes("client-version")) {
      return new LxEnterpriseToolsError(
        "CLIENT_VERSION_REQUIRED",
        "灵犀服务要求提供兼容的客户端版本。",
      );
    }
    if (normalizedMessage.includes("x-mcp-token")) {
      return new LxEnterpriseToolsError(
        "AUTH_FAILED",
        "灵犀服务认证失败，请检查 LX_MCP_TOKEN。",
      );
    }
    return new LxEnterpriseToolsError(
      "REQUEST_HEADER_INVALID",
      "灵犀 MCP 请求头不完整或不兼容。",
    );
  }

  return new LxEnterpriseToolsError(
    "JSON_RPC_ERROR",
    "灵犀 MCP 调用失败，请稍后重试。",
  );
};

const buildHeaders = (
  context: RequestContext,
  sessionId?: string,
): Record<string, string> => ({
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  "x-mcp-token": context.token,
  "x-mcp-biz-group": context.toolConfig.bizGroup,
  "X-Skill-Name": context.toolConfig.skillName,
  "X-Skill-Version": context.toolConfig.skillVersion,
  // 原 WorkBuddy Skill 使用 skill version 作为 client-version；灵犀网关会强制校验此头。
  "client-version": context.toolConfig.skillVersion,
  "User-Agent": `${context.toolConfig.skillName}/${context.toolConfig.skillVersion}`,
  platform: context.platform,
  ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
});

/**
 * 发送单个 JSON-RPC 请求。
 * 通知允许 202/204 空响应；普通调用必须得到可解码的 JSON-RPC 对象。
 */
const postJsonRpc = async ({
  context,
  method,
  params,
  sessionId,
  notification = false,
}: {
  context: RequestContext;
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
  notification?: boolean;
}): Promise<{ response?: JsonRpcResponse; headers: Headers }> => {
  const body: Record<string, unknown> = {
    jsonrpc: "2.0",
    method,
    params,
  };
  if (!notification) body.id = context.nextRequestId();

  let httpResponse: Response;
  try {
    httpResponse = await context.fetch(context.baseUrl, {
      method: "POST",
      headers: buildHeaders(context, sessionId),
      body: JSON.stringify(body),
      signal: context.signal,
    });
  } catch (error) {
    // 上层会把由定时器或调用方触发的 abort 转换成更准确的提示。
    if (context.signal.aborted) throw error;
    throw new LxEnterpriseToolsError(
      "NETWORK_ERROR",
      "无法连接灵犀查询服务，请稍后重试。",
    );
  }

  if (!httpResponse.ok) throw getHttpError(httpResponse.status);
  const responseBody = await httpResponse.text();
  if (!responseBody.trim()) {
    if (notification) return { headers: httpResponse.headers };
    throw new LxEnterpriseToolsError(
      "EMPTY_RESPONSE",
      "灵犀服务返回了空响应。",
    );
  }

  const response = decodeResponse(
    responseBody,
    httpResponse.headers.get("content-type") ?? "",
  );
  if (response.error !== undefined) {
    throw getJsonRpcError(response.error);
  }
  return { response, headers: httpResponse.headers };
};

const parseTextPayload = (text: string): LxEnterpriseToolOutput => {
  try {
    return { format: "json", payload: JSON.parse(text) as unknown };
  } catch {
    return { format: "text", payload: text };
  }
};

/** 将 MCP content 转成稳定的 Agent 工具结果，同时保留业务字段的原始值。 */
const normalizeToolResult = (response: JsonRpcResponse): LxEnterpriseToolOutput => {
  if (!isRecord(response.result)) {
    throw new LxEnterpriseToolsError(
      "INVALID_TOOL_RESULT",
      "灵犀服务返回了无效的工具结果。",
    );
  }
  const toolResult = response.result as McpToolResult;
  if (toolResult.isError === true) {
    throw new LxEnterpriseToolsError(
      "TOOL_ERROR",
      "灵犀业务查询失败，请核对查询条件后重试。",
    );
  }

  // structuredContent 已是 JSON 兼容对象，优先于文本块，避免重复解析和字段损失。
  if (toolResult.structuredContent !== undefined) {
    return { format: "json", payload: toolResult.structuredContent };
  }

  const texts = (toolResult.content ?? [])
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string);
  if (texts.length > 0) return parseTextPayload(texts.join("\n"));

  // 非文本 MCP 内容仍作为 JSON 结构返回，不截断或伪造为文本。
  return { format: "json", payload: response.result };
};

const createAbortContext = (
  timeoutMs: number,
  sourceSignal?: AbortSignal,
): {
  signal: AbortSignal;
  wasTimedOut: () => boolean;
  dispose: () => void;
} => {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const forwardAbort = () => controller.abort(sourceSignal?.reason);
  if (sourceSignal?.aborted) forwardAbort();
  else sourceSignal?.addEventListener("abort", forwardAbort, { once: true });

  return {
    signal: controller.signal,
    wasTimedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timeout);
      sourceSignal?.removeEventListener("abort", forwardAbort);
    },
  };
};

/**
 * 每次工具执行创建独立 MCP 会话，适合无状态的 Next.js/Vercel 服务端运行时。
 * 连接顺序严格为 initialize → notifications/initialized → tools/call。
 */
export const callLxMcpTool = async (
  options: CallLxMcpToolOptions,
): Promise<LxEnterpriseToolOutput> => {
  const abortContext = createAbortContext(options.timeoutMs, options.abortSignal);
  let requestId = 0;
  const context: RequestContext = {
    baseUrl: options.baseUrl,
    token: options.token,
    platform: options.platform,
    fetch: options.fetch,
    toolConfig: options.toolConfig,
    signal: abortContext.signal,
    nextRequestId: () => {
      requestId += 1;
      return requestId;
    },
  };

  try {
    const initialized = await postJsonRpc({
      context,
      method: "initialize",
      params: {
        protocolVersion: LX_ENTERPRISE_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: options.toolConfig.skillName,
          version: options.toolConfig.skillVersion,
        },
      },
    });
    const sessionId = initialized.headers.get("mcp-session-id") ?? undefined;

    if (sessionId) {
      await postJsonRpc({
        context,
        method: "notifications/initialized",
        params: {},
        sessionId,
        notification: true,
      });
    }

    const called = await postJsonRpc({
      context,
      method: "tools/call",
      params: { name: options.toolName, arguments: options.arguments },
      sessionId,
    });
    if (!called.response) {
      throw new LxEnterpriseToolsError(
        "EMPTY_RESPONSE",
        "灵犀服务返回了空响应。",
      );
    }
    return normalizeToolResult(called.response);
  } catch (error) {
    if (error instanceof LxEnterpriseToolsError) throw error;
    if (abortContext.wasTimedOut()) {
      throw new LxEnterpriseToolsError(
        "TIMEOUT",
        "灵犀查询超时，请稍后重试。",
      );
    }
    if (options.abortSignal?.aborted) {
      throw new LxEnterpriseToolsError("ABORTED", "灵犀查询已取消。");
    }
    throw new LxEnterpriseToolsError(
      "NETWORK_ERROR",
      "无法连接灵犀查询服务，请稍后重试。",
    );
  } finally {
    abortContext.dispose();
  }
};
