import type { UIMessage } from "ai";

export type ReportTemplate = {
  id: string;
  name: string;
  description: string;
  variables: Array<{ key: string; value: string }>;
  explainStructure: string;
  consistencyRules: string;
  constraintRules: string;
  exceptionBoundaryRules: string;
  verificationRules: string;
};

/** 设计风格只影响视觉呈现，不能承担报告结构或事实约束。 */
export type DesignStyle = {
  id: string;
  name: string;
  description: string;
  promptRules: string;
  isDefault: boolean;
};

/** 服务端生成并贯穿单次报告任务的可信运行时上下文。 */
export type ReportRuntimeContext = {
  currentDate: string;
  timeZone: "Asia/Shanghai";
};

export type ResearchLedger = {
  summary: string;
  facts: Array<{
    statement: string;
    sourceType: "user" | "lx_tool" | "mock_report" | "web_search";
    sourceLabel: string;
  }>;
  calculations: Array<{ label: string; formula: string; result: string }>;
  limitations: string[];
};

export type ReviewResult = {
  passed: boolean;
  issues: string[];
  repairInstructions: string[];
};

export type ReportAgentResult =
  | { outcome: "needs_input"; message: string; missingItems: string[] }
  | { outcome: "report"; title: string }
  | { outcome: "error"; message: string; retryable: boolean };

export type ReportAgentDataParts = {
  status: { stage: string; label: string };
  result: ReportAgentResult;
  report: { title: string };
};

export type ReportAgentUIMessage = UIMessage<unknown, ReportAgentDataParts>;

export type ReportWorkflowResult =
  | Extract<ReportAgentResult, { outcome: "needs_input" | "error" }>
  | { outcome: "report"; title: string; markdown: string };
