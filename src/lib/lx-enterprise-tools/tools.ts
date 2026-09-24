import { tool } from "ai";
import {
  LX_ENTERPRISE_DEFAULT_BASE_URL,
  LX_ENTERPRISE_DEFAULT_PLATFORM,
  LX_ENTERPRISE_DEFAULT_TIMEOUT_MS,
  LX_ENTERPRISE_REMOTE_TOOLS,
  type LxEnterpriseRemoteToolName,
} from "./constants";
import { callLxMcpTool } from "./mcp-client";
import { resolveEnterpriseRegion } from "./region-resolver";
import {
  advancedCompanySearchInputSchema,
  companyRegistrationInputSchema,
  paginatedCompanyDetailInputSchema,
  resolveEnterpriseRegionInputSchema,
} from "./schemas";
import type {
  CreateLxEnterpriseToolsOptions,
  LxEnterpriseToolOutput,
} from "./types";
import { LxEnterpriseToolsError } from "./types";

const resolveOptions = (options: CreateLxEnterpriseToolsOptions) => {
  const token = options.token?.trim() || process.env.LX_MCP_TOKEN?.trim();
  if (!token) {
    throw new LxEnterpriseToolsError(
      "MISSING_TOKEN",
      "缺少 LX_MCP_TOKEN，请在服务端环境变量或工具构造参数中配置。",
    );
  }

  const baseUrl = options.baseUrl?.trim() || LX_ENTERPRISE_DEFAULT_BASE_URL;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new LxEnterpriseToolsError(
      "INVALID_BASE_URL",
      "灵犀 MCP 服务地址格式不正确。",
    );
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new LxEnterpriseToolsError(
      "INVALID_BASE_URL",
      "灵犀 MCP 服务地址必须使用 HTTP 或 HTTPS。",
    );
  }

  const timeoutMs = options.timeoutMs ?? LX_ENTERPRISE_DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new LxEnterpriseToolsError(
      "INVALID_TIMEOUT",
      "灵犀 MCP 超时时间必须是正数。",
    );
  }

  const platform = options.platform?.trim() || LX_ENTERPRISE_DEFAULT_PLATFORM;
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new LxEnterpriseToolsError(
      "MISSING_FETCH",
      "当前服务端运行环境不支持 fetch。",
    );
  }

  return {
    token,
    baseUrl: parsedUrl.toString(),
    timeoutMs,
    platform,
    fetch: fetchImplementation,
  };
};

/**
 * 创建可直接传给 AI SDK tools 参数的灵犀企业工具集。
 * 工具闭包只保存服务端配置，不创建长连接；每次 execute 都建立独立 MCP 会话。
 */
export const createLxEnterpriseTools = (
  options: CreateLxEnterpriseToolsOptions = {},
) => {
  const resolved = resolveOptions(options);

  const executeRemote = (
    toolName: LxEnterpriseRemoteToolName,
    args: Record<string, unknown>,
    abortSignal?: AbortSignal,
  ): Promise<LxEnterpriseToolOutput> =>
    callLxMcpTool({
      ...resolved,
      toolName,
      toolConfig: LX_ENTERPRISE_REMOTE_TOOLS[toolName],
      arguments: args,
      abortSignal,
    });

  return {
    resolveEnterpriseRegion: tool({
      description:
        "将省、市、区县、复合地区名或行政区代码解析为标准地区候选。必须在 advancedCompanySearch 使用地区筛选前调用；歧义时根据 full_path 请用户确认，不能猜测。",
      metadata: { source: "lx-enterprise", kind: "local" },
      inputSchema: resolveEnterpriseRegionInputSchema,
      execute: async ({ query }): Promise<LxEnterpriseToolOutput> => ({
        format: "json",
        payload: resolveEnterpriseRegion(query),
      }),
    }),

    advancedCompanySearch: tool({
      description:
        "按企业名称、简称、名称关键词、法定代表人姓名和高级筛选条件查询企业列表。所有条件必须放入同一个 params，一次只查一页；地区必须先解析为行政区 code。返回的 companyId 仅供后续详情工具内部联动。",
      metadata: { source: "lx-enterprise", kind: "mcp" },
      inputSchema: advancedCompanySearchInputSchema,
      execute: async (input, { abortSignal }) =>
        executeRemote(
          "advancedCompanySearch",
          input as Record<string, unknown>,
          abortSignal,
        ),
    }),

    getCompanyRegistrationInformation: tool({
      description:
        "使用企业搜索结果中的内部 companyId 查询企业工商登记信息。只有目标企业已唯一确定时调用，companyId 不得出现在最终回答中。",
      metadata: { source: "lx-enterprise", kind: "mcp" },
      inputSchema: companyRegistrationInputSchema,
      execute: async (input, { abortSignal }) =>
        executeRemote(
          "getCompanyRegistrationInformation",
          input as Record<string, unknown>,
          abortSignal,
        ),
    }),

    getCompanyShareholders: tool({
      description:
        "使用内部 companyId 查询企业股东列表。current 仅在用户明确指定页码或确认续查时传入。",
      metadata: { source: "lx-enterprise", kind: "mcp" },
      inputSchema: paginatedCompanyDetailInputSchema,
      execute: async (input, { abortSignal }) =>
        executeRemote(
          "getCompanyShareholders",
          input as Record<string, unknown>,
          abortSignal,
        ),
    }),

    getCompanyCoreMembers: tool({
      description:
        "使用内部 companyId 查询企业主要成员列表。current 仅在用户明确指定页码或确认续查时传入。",
      metadata: { source: "lx-enterprise", kind: "mcp" },
      inputSchema: paginatedCompanyDetailInputSchema,
      execute: async (input, { abortSignal }) =>
        executeRemote(
          "getCompanyCoreMembers",
          input as Record<string, unknown>,
          abortSignal,
        ),
    }),

    getCompanySubsidiaries: tool({
      description:
        "使用内部 companyId 查询企业分支机构列表。current 仅在用户明确指定页码或确认续查时传入。",
      metadata: { source: "lx-enterprise", kind: "mcp" },
      inputSchema: paginatedCompanyDetailInputSchema,
      execute: async (input, { abortSignal }) =>
        executeRemote(
          "getCompanySubsidiaries",
          input as Record<string, unknown>,
          abortSignal,
        ),
    }),

    getCompanyOutwardInvestmentList: tool({
      description:
        "使用内部 companyId 查询企业对外投资列表。current 仅在用户明确指定页码或确认续查时传入。",
      metadata: { source: "lx-enterprise", kind: "mcp" },
      inputSchema: paginatedCompanyDetailInputSchema,
      execute: async (input, { abortSignal }) =>
        executeRemote(
          "getCompanyOutwardInvestmentList",
          input as Record<string, unknown>,
          abortSignal,
        ),
    }),
  };
};

export type LxEnterpriseTools = ReturnType<typeof createLxEnterpriseTools>;
