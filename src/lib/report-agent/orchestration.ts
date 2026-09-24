import type {
  ReportRuntimeContext,
  ReportTemplate,
  ResearchLedger,
} from "./types";

export const MAX_REPORT_WORKFLOW_STEPS = 12;

/**
 * 临时关闭 LLM 质量审查、自动修复与最终安全处理；恢复时只需改为 true 并重新发布。
 * 开关关闭时会直接交付 Writer 生成的、已通过 Markdown 格式校验的原始报告。
 */
export const REPORT_REVIEW_AND_REPAIR_ENABLED = false;

export type ReportWorkflowPhase =
  | "match"
  | "clarify"
  | "research"
  | "write-draft"
  | "review-draft"
  | "write-repair"
  | "review-repair"
  | "deliver"
  | "fail"
  | "done";

type ReportPhaseOutcome =
  | "success"
  | "needs-input"
  | "passed"
  | "rejected"
  | "error"
  | "complete";

/**
 * 集中定义工作流的合法状态转换，使模型输出只能影响审查结论，不能决定执行顺序。
 * 不合法的组合属于服务端实现缺陷，立即抛错而不是猜测下一阶段。
 */
export function getNextReportPhase(
  phase: Exclude<ReportWorkflowPhase, "done">,
  outcome: ReportPhaseOutcome,
  reviewAndRepairEnabled = REPORT_REVIEW_AND_REPAIR_ENABLED,
): ReportWorkflowPhase {
  if (outcome === "error") return "fail";

  if (phase === "match") {
    if (outcome === "success") return "research";
    if (outcome === "needs-input") return "clarify";
  } else if (phase === "research" && outcome === "success") {
    return "write-draft";
  } else if (phase === "write-draft" && outcome === "success") {
    // 临时关闭审查时，初稿直接进入仍包含安全清洗的交付阶段。
    return reviewAndRepairEnabled ? "review-draft" : "deliver";
  } else if (phase === "review-draft") {
    if (outcome === "passed") return "deliver";
    if (outcome === "rejected") return "write-repair";
  } else if (phase === "write-repair" && outcome === "success") {
    return "review-repair";
  } else if (
    phase === "review-repair" &&
    (outcome === "passed" || outcome === "rejected")
  ) {
    return "deliver";
  } else if (
    (phase === "clarify" || phase === "deliver" || phase === "fail") &&
    outcome === "complete"
  ) {
    return "done";
  }

  throw new Error(`非法的报告状态转换：${phase} -> ${outcome}`);
}

/**
 * 使用固定时区生成 YYYY-MM-DD，避免部署机器的本地时区影响报告日期。
 * now 参数便于测试跨时区和跨日期边界，无需依赖系统时钟。
 */
export const createReportRuntimeContext = (
  now = new Date(),
): ReportRuntimeContext => ({
  currentDate: new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now),
  timeZone: "Asia/Shanghai",
});

/** 严格裁剪匹配输入，防止模板变量和正文规则进入匹配 Agent。 */
export const createTemplateMatchCandidates = (templates: ReportTemplate[]) =>
  templates.map(({ name, description }) => ({ name, description }));

type ReportWriterPromptInput = {
  request: string;
  runtimeContext: ReportRuntimeContext;
  templateArtifact: {
    template: ReportTemplate;
    variableValues: Record<string, string>;
  };
  research: ResearchLedger;
  previousHtml?: string;
  repairInstructions?: string[];
};

/**
 * Writer 与 Reviewer 只需要事实本身，不需要研究阶段的来源元数据。
 * 在确定性边界移除来源字段，避免模型通过提示词感知或复述数据渠道。
 */
export const createReportPresentationResearch = (research: ResearchLedger) => ({
  summary: research.summary,
  facts: research.facts.map(({ statement }) => ({ statement })),
  calculations: research.calculations,
  limitations: research.limitations,
});

/**
 * Writer 只接收数据库模板和研究后的事实账本，完整 mock 成品永远停留在 Research 边界内。
 * 独立构造上下文便于测试，防止后续维护时意外把资料原文直接传给 Writer。
 */
export const createReportWriterPrompt = ({
  request,
  runtimeContext,
  templateArtifact,
  research,
  previousHtml,
  repairInstructions,
}: ReportWriterPromptInput) =>
  JSON.stringify({
    request,
    runtimeContext,
    ...templateArtifact,
    research: createReportPresentationResearch(research),
    previousHtml,
    repairInstructions,
  });
