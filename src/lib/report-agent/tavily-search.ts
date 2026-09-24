import "server-only";

import { tavilySearch } from "@tavily/ai-sdk";

/**
 * Tavily 只作为灵犀与演示资料的补充数据源。
 * API Key 由 SDK 从服务端 TAVILY_API_KEY 环境变量读取，不进入客户端代码或提示词。
 */
export const createReportWebSearchTool = () =>
  tavilySearch({
    searchDepth: "advanced",
    maxResults: 5,
    includeAnswer: false,
  });
