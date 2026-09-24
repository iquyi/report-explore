export type LxEnterpriseFetch = typeof globalThis.fetch;

/** 创建工具时可覆盖的服务端参数；默认值与原 WorkBuddy skill 保持兼容。 */
export type CreateLxEnterpriseToolsOptions = {
  /** 优先使用显式 Token；省略时读取服务端环境变量 LX_MCP_TOKEN。 */
  token?: string;
  baseUrl?: string;
  timeoutMs?: number;
  platform?: string;
  /** 主要用于测试、审计代理或需要自定义网络层的服务端运行环境。 */
  fetch?: LxEnterpriseFetch;
};

/** 工具结果统一包装，避免把 MCP 协议层细节暴露给 Agent。 */
export type LxEnterpriseToolOutput =
  | { format: "json"; payload: unknown }
  | { format: "text"; payload: string };

export type RegionLevel = 1 | 2 | 3;

export type RegionMatch = {
  code: string;
  level: RegionLevel;
  name: string;
  full_path: string;
  l1_code: string;
  l1_name: string;
};

export type RegionResolution = {
  status: "unique" | "ambiguous" | "not_found";
  matches: RegionMatch[];
};

/**
 * 可预期的配置或传输错误。
 * message 只包含可安全展示的中文提示，不携带 Token、请求头、端点或响应正文。
 */
export class LxEnterpriseToolsError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LxEnterpriseToolsError";
    this.code = code;
  }
}
