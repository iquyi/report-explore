import type { Tool } from "ai";

export type ResearchToolStats = {
  cacheHitCount: number;
  webSearchExecutionCount: number;
  advancedCompanySearchExecutionCount: number;
};

export type ResearchToolController = {
  wrapTools: <TTools extends Record<string, Tool>>(tools: TTools) => TTools;
  getStats: () => ResearchToolStats;
};

/**
 * 对工具参数做稳定序列化，确保字段顺序、空白和 Unicode 表示差异不会绕过缓存。
 * 数组顺序可能具有业务含义，因此只规范化元素，不对数组排序。
 */
const normalizeToolValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  }
  if (Array.isArray(value)) return value.map(normalizeToolValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeToolValue(item)]),
    );
  }
  return value;
};

const stableToolKey = (toolName: string, input: unknown) =>
  `${toolName}:${JSON.stringify(normalizeToolValue(input))}`;

/** Tavily 只按规范化查询文本去重，避免模型用空白或大小写制造重复请求。 */
const stableWebSearchKey = (input: unknown) => {
  const query = typeof input === "object" && input !== null
    ? (input as { query?: unknown }).query
    : undefined;
  const normalizedQuery = typeof query === "string"
    ? query.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US")
    : "";
  return `tavilySearch:${normalizedQuery}`;
};

/**
 * 为一次报告工作流创建独立的工具控制器：并发重复调用共享 Promise，失败后允许重试。
 * 所有工具均不限制调用次数；Tavily 按查询文本缓存，其他工具按完整参数缓存。
 */
export function createResearchToolController(): ResearchToolController {
  const cache = new Map<string, Promise<unknown>>();
  const stats: ResearchToolStats = {
    cacheHitCount: 0,
    webSearchExecutionCount: 0,
    advancedCompanySearchExecutionCount: 0,
  };

  const wrapTools = <TTools extends Record<string, Tool>>(tools: TTools): TTools =>
    Object.fromEntries(Object.entries(tools).map(([toolName, originalTool]) => {
      if (!("execute" in originalTool) || typeof originalTool.execute !== "function") {
        return [toolName, originalTool];
      }

      const execute = originalTool.execute;
      const wrappedTool = {
        ...originalTool,
        execute: (input: unknown, options: Parameters<typeof execute>[1]) => {
          const key = toolName === "tavilySearch"
            ? stableWebSearchKey(input)
            : stableToolKey(toolName, input);
          const cached = cache.get(key);
          if (cached) {
            stats.cacheHitCount += 1;
            return cached;
          }

          // 统计真实后端执行次数；缓存命中的等价调用不会重复计数。
          if (toolName === "tavilySearch") stats.webSearchExecutionCount += 1;
          if (toolName === "advancedCompanySearch") {
            stats.advancedCompanySearchExecutionCount += 1;
          }

          const execution = Promise.resolve(execute(input, options));
          cache.set(key, execution);
          // 失败结果不永久缓存，让模型后续可以重试同一请求。
          void execution.catch(() => cache.delete(key));
          return execution;
        },
      } as Tool;
      return [toolName, wrappedTool];
    })) as TTools;

  return {
    wrapTools,
    getStats: () => ({ ...stats }),
  };
}
