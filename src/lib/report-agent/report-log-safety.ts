export type SafeErrorDetails = Record<
  string,
  string | number | boolean | null | undefined
>;

type ResearchFactForLogging = {
  statement: string;
  sourceType: "user" | "lx_tool" | "mock_report" | "web_search";
};

const compact = (value: string, limit: number) =>
  value.length <= limit ? value : `${value.slice(0, limit)}…`;

/** AI SDK 的 JSON 解析错误会内嵌完整模型文本，只保留末尾的底层语法原因。 */
export const sanitizeReportErrorMessage = (message: string) => {
  const errorMarker = "\nError message: ";
  const errorIndex = message.lastIndexOf(errorMarker);
  if (message.includes("JSON parsing failed: Text:") && errorIndex >= 0) {
    return `JSON parsing failed: ${compact(
      message.slice(errorIndex + errorMarker.length),
      500,
    )}`;
  }
  return compact(message, 500);
};

/** 记录脱敏后的最外层和最内层错误，跳过可能携带模型正文的中间包装错误。 */
export const describeReportError = (error: unknown): SafeErrorDetails => {
  if (!(error instanceof Error)) return { errorType: typeof error };
  let deepestCause: Error | undefined;
  let currentCause = error.cause;
  while (currentCause instanceof Error) {
    deepestCause = currentCause;
    currentCause = currentCause.cause;
  }
  return {
    errorName: error.name,
    errorMessage: sanitizeReportErrorMessage(error.message),
    causeName: deepestCause?.name,
    causeMessage: deepestCause
      ? sanitizeReportErrorMessage(deepestCause.message)
      : undefined,
  };
};

/**
 * 事实正文只允许进入本地开发日志。刻意不接收 sourceLabel，避免 URL、文件名或内部标识
 * 被调用方意外展开到任何环境的诊断事件中。
 */
export const createResearchFactBodyLogEntries = (
  workflowId: string,
  facts: readonly ResearchFactForLogging[],
  nodeEnv = process.env.NODE_ENV,
): SafeErrorDetails[] => nodeEnv === "development"
  ? facts.map((fact, index) => ({
      workflowId,
      factIndex: index + 1,
      sourceType: fact.sourceType,
      statement: fact.statement,
    }))
  : [];
