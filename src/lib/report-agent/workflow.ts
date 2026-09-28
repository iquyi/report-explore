import "server-only";

import { ReportArtifactStore } from "./artifact-store";
import { extractReportTitle } from "./html-safety";
import {
  createResearchFactBodyLogEntries,
  describeReportError,
} from "./report-log-safety";
import {
  generateReportMarkdownWithRetry,
  prepareReportMarkdownForDelivery,
} from "./report-markdown";
import {
  generateTextProtocolWithRetry,
  inspectReportTextProtocol,
  normalizeResearchLedgerFacts,
  parseMatchDecision,
  parseResearchLedger,
  parseReviewResult,
  parseStyleMatchDecision,
  repairResearchProtocolLocally,
  ReportTextProtocolFormatError,
  type ReportTextProtocol,
  type ReportTextProtocolDiagnostics,
} from "./report-text-protocol";
import {
  getResearchStageLabel,
  loadMockReportSource,
} from "./mock-report-sources";
import {
  createReportPresentationResearch,
  createReportRuntimeContext,
  createReportWriterPrompt,
  createDesignStyleMatchCandidates,
  createTemplateMatchCandidates,
  findDesignStyleById,
  findExplicitDesignStyle,
  getNextReportPhase,
  MAX_REPORT_WORKFLOW_STEPS,
  resolveDesignStyle,
  type ReportWorkflowPhase,
} from "./orchestration";
import {
  queryPublishedDesignStyles,
  queryPublishedReportTemplates,
} from "./repository";
import {
  createResearchAgent,
  generateDesignStyleMatch,
  generateHtmlReport,
  generateQualityReview,
  generateTemplateMatch,
} from "./subagents";
import { createReportWebSearchTool } from "./tavily-search";
import { createResearchToolController } from "./research-tool-control";
import type { ReportWorkflowResult } from "./types";

type WorkflowState = {
  phase: ReportWorkflowPhase;
  templateArtifactId?: string;
  styleArtifactId?: string;
  researchArtifactId?: string;
  reportArtifactId?: string;
  firstReviewArtifactId?: string;
  clarification?: { message: string; missingItems: string[] };
  technicalError?: string;
  result?: ReportWorkflowResult;
};

export type RunReportWorkflowInput = {
  userMessage: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  styleId?: string;
  abortSignal?: AbortSignal;
  onStage?: (stage: string, label: string) => void;
};

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

type ReportLogDetails = Record<
  string,
  string | number | boolean | null | undefined
>;

type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  outputTokenDetails?: {
    textTokens?: number;
    reasoningTokens?: number;
  };
};

/**
 * 使用单行 JSON 字符串记录日志，避免 Next 开发日志把附加对象序列化为 `{}`。
 * 日志只接收标量诊断信息，禁止传入提示词、工具结果或完整 HTML；研究事实正文
 * 仅通过开发环境专用的安全入口写入。
 */
const logReportEvent = (
  level: "info" | "warn" | "error",
  event: string,
  details: ReportLogDetails,
) => {
  console[level](`[report-agent] ${JSON.stringify({ event, ...details })}`);
};

/** 将模型用量压平为单行标量字段，便于识别输出截断和异常推理消耗。 */
const describeUsage = (usage: ModelUsage | undefined): ReportLogDetails => ({
  inputTokens: usage?.inputTokens,
  outputTokens: usage?.outputTokens,
  textTokens: usage?.outputTokenDetails?.textTokens,
  reasoningTokens: usage?.outputTokenDetails?.reasoningTokens,
  totalTokens: usage?.totalTokens,
});

type TextGenerationDetails = {
  text: string;
  finishReason: string;
  rawFinishReason?: string;
  steps: ReadonlyArray<unknown>;
  warnings?: ReadonlyArray<unknown>;
  usage: ModelUsage;
};

const describeGeneration = (
  result: TextGenerationDetails,
): ReportLogDetails => ({
  finishReason: result.finishReason,
  rawFinishReason: result.rawFinishReason,
  outputLength: result.text.length,
  stepCount: result.steps.length,
  warningCount: result.warnings?.length ?? 0,
  ...describeUsage(result.usage),
});

const logProtocolValidation = (
  level: "info" | "warn",
  event: string,
  context: {
    workflowId: string;
    phase: Exclude<ReportWorkflowPhase, "done">;
    capability: string;
    protocol: ReportTextProtocol;
    attemptNumber: number;
    formatRetry: boolean;
    diagnostics: ReportTextProtocolDiagnostics;
    error?: unknown;
  },
) => {
  const { diagnostics, error, ...details } = context;
  logReportEvent(level, event, {
    ...details,
    ...diagnostics,
    ...(error ? describeReportError(error) : {}),
  });
};

/** 专业能力执行错误转入显式 fail 阶段；用户取消则继续向上传播。 */
const guard = async <T>(
  state: WorkflowState,
  context: {
    workflowId: string;
    capability: string;
    phase: Exclude<ReportWorkflowPhase, "done">;
  },
  operation: () => Promise<T>,
  summarize: (result: T) => ReportLogDetails,
) => {
  const startedAt = Date.now();
  logReportEvent("info", "capability.started", context);
  try {
    const result = await operation();
    logReportEvent("info", "capability.completed", {
      ...context,
      durationMs: Date.now() - startedAt,
      ...summarize(result),
    });
    return result;
  } catch (error) {
    if (isAbortError(error)) throw error;
    logReportEvent("error", "capability.failed", {
      ...context,
      durationMs: Date.now() - startedAt,
      ...describeReportError(error),
    });
    // 具体工具、服务或配置错误只进入服务端日志，不能通过 SSE 结果暴露数据渠道。
    state.technicalError = "报告生成服务暂时不可用，请稍后重试。";
    state.phase = getNextReportPhase(context.phase, "error");
    return undefined;
  }
};

export async function runReportWorkflow(
  input: RunReportWorkflowInput,
): Promise<ReportWorkflowResult> {
  const [templates, designStyles] = await Promise.all([
    queryPublishedReportTemplates(),
    queryPublishedDesignStyles(),
  ]);
  const runtimeContext = createReportRuntimeContext();
  const store = new ReportArtifactStore();
  const state: WorkflowState = { phase: "match" };
  const workflowId = crypto.randomUUID();
  const workflowStartedAt = Date.now();

  logReportEvent("info", "workflow.started", {
    workflowId,
    historyCount: input.history?.length ?? 0,
    templateCount: templates.length,
    designStyleCount: designStyles.length,
  });

  let totalStepCount = 0;

  /**
   * 报告的阶段顺序完全由服务端状态决定，不再让模型重复选择下一项调度工具。
   * 13 步上限用于防止未来修改阶段转换时意外形成死循环。
   */
  while (
    state.phase !== "done" &&
    totalStepCount < MAX_REPORT_WORKFLOW_STEPS
  ) {
    const currentPhase: Exclude<ReportWorkflowPhase, "done"> = state.phase;
    const stepStartedAt = Date.now();

    logReportEvent("info", "workflow.step_started", {
      workflowId,
      stepNumber: totalStepCount,
      phase: currentPhase,
    });

    switch (currentPhase) {
      case "match": {
        input.onStage?.("matching", "正在匹配报告模板…");
        const generated = await guard(
          state,
          {
            workflowId,
            capability: "report-template-matcher",
            phase: currentPhase,
          },
          () => {
            const prompt = JSON.stringify({
              request: input.userMessage,
              history: input.history ?? [],
              runtimeContext,
              templates: createTemplateMatchCandidates(templates),
            });
            return generateTextProtocolWithRetry(
              async (formatRetry) => {
                const attemptStartedAt = Date.now();
                logReportEvent("info", "protocol.generation_started", {
                  workflowId,
                  phase: currentPhase,
                  capability: "report-template-matcher",
                  protocol: "match",
                  attemptNumber: formatRetry ? 2 : 1,
                  formatRetry,
                });
                try {
                  const result = await generateTemplateMatch({
                    abortSignal: input.abortSignal,
                    formatRetry,
                    prompt,
                  });
                  logReportEvent("info", "protocol.generation_completed", {
                    workflowId,
                    phase: currentPhase,
                    capability: "report-template-matcher",
                    protocol: "match",
                    attemptNumber: formatRetry ? 2 : 1,
                    formatRetry,
                    durationMs: Date.now() - attemptStartedAt,
                    ...describeGeneration(result),
                  });
                  return result;
                } catch (error) {
                  logReportEvent("error", "protocol.generation_failed", {
                    workflowId,
                    phase: currentPhase,
                    capability: "report-template-matcher",
                    protocol: "match",
                    attemptNumber: formatRetry ? 2 : 1,
                    formatRetry,
                    durationMs: Date.now() - attemptStartedAt,
                    ...describeReportError(error),
                  });
                  throw error;
                }
              },
              parseMatchDecision,
              {
                protocol: "match",
                onValidationSucceeded: (event) => logProtocolValidation(
                  "info",
                  "protocol.validation_succeeded",
                  {
                    workflowId,
                    phase: currentPhase,
                    capability: "report-template-matcher",
                    protocol: "match",
                    ...event,
                  },
                ),
                onValidationFailed: (event) => logProtocolValidation(
                  "warn",
                  "protocol.validation_failed",
                  {
                    workflowId,
                    phase: currentPhase,
                    capability: "report-template-matcher",
                    protocol: "match",
                    ...event,
                  },
                ),
              },
            );
          },
          (result) => ({
            finishReason: result.generation.finishReason,
            rawFinishReason: result.generation.rawFinishReason,
            stepCount: result.generation.steps.length,
            outputLength: result.generation.text.length,
            formatAttemptCount: result.attemptCount,
            ...describeUsage(result.generation.usage),
          }),
        );
        const decision = generated?.parsed;
        if (!decision) break;

        if (decision.outcome !== "matched" || !decision.templateName) {
          state.clarification = {
            message:
              decision.outcome === "unsupported_adjustment"
                ? "当前不支持修改上一份报告，请提交一项新的完整报告需求。"
                : decision.message,
            missingItems: [],
          };
          state.phase = getNextReportPhase(currentPhase, "needs-input");
          break;
        }

        const template = templates.find((item) => item.name === decision.templateName);
        if (!template) {
          state.technicalError = "模板匹配结果无效，请重新发起报告任务。";
          state.phase = getNextReportPhase(currentPhase, "error");
          break;
        }
        state.templateArtifactId = store.put("template", {
          template,
          variableValues: {},
        });
        state.phase = getNextReportPhase(currentPhase, "success");
        break;
      }

      case "match-style": {
        input.onStage?.(
          "matching-style",
          input.styleId ? "正在应用指定设计风格…" : "正在匹配设计风格…",
        );
        const requestedStyle = input.styleId
          ? findDesignStyleById(designStyles, input.styleId)
          : undefined;

        // 指定风格可能在卡片加载后被停用或删除，此时必须明确失败，不能悄悄换风格。
        if (input.styleId && !requestedStyle) {
          state.technicalError = "所选设计风格已停用或不存在，请重新选择。";
          state.phase = getNextReportPhase(currentPhase, "error");
          logReportEvent("warn", "design_style.requested_unavailable", {
            workflowId,
            styleId: input.styleId,
          });
          break;
        }

        // 已携带 ID 时不再执行任何其他风格推断，确保用户选择拥有最高优先级。
        const explicitStyle = input.styleId
          ? undefined
          : findExplicitDesignStyle(input.userMessage, designStyles);
        let selectedStyle = requestedStyle ?? explicitStyle;
        let selectionSource:
          | "user-specified-id"
          | "explicit-name"
          | "single-candidate"
          | "model"
          | "default-no-match"
          | "default-invalid-id"
          | "default-error" = requestedStyle
            ? "user-specified-id"
            : explicitStyle
              ? "explicit-name"
              : "single-candidate";

        if (!selectedStyle && designStyles.length === 1) {
          selectedStyle = designStyles[0];
        } else if (!selectedStyle) {
          const capability = "report-design-style-matcher";
          const startedAt = Date.now();
          logReportEvent("info", "capability.started", {
            workflowId,
            capability,
            phase: currentPhase,
          });
          try {
            const prompt = JSON.stringify({
              request: input.userMessage,
              history: input.history ?? [],
              runtimeContext,
              styles: createDesignStyleMatchCandidates(designStyles),
            });
            const generated = await generateTextProtocolWithRetry(
              async (formatRetry) => {
                const attemptStartedAt = Date.now();
                logReportEvent("info", "protocol.generation_started", {
                  workflowId,
                  phase: currentPhase,
                  capability,
                  protocol: "style-match",
                  attemptNumber: formatRetry ? 2 : 1,
                  formatRetry,
                });
                try {
                  const result = await generateDesignStyleMatch({
                    abortSignal: input.abortSignal,
                    formatRetry,
                    prompt,
                  });
                  logReportEvent("info", "protocol.generation_completed", {
                    workflowId,
                    phase: currentPhase,
                    capability,
                    protocol: "style-match",
                    attemptNumber: formatRetry ? 2 : 1,
                    formatRetry,
                    durationMs: Date.now() - attemptStartedAt,
                    ...describeGeneration(result),
                  });
                  return result;
                } catch (error) {
                  logReportEvent("error", "protocol.generation_failed", {
                    workflowId,
                    phase: currentPhase,
                    capability,
                    protocol: "style-match",
                    attemptNumber: formatRetry ? 2 : 1,
                    formatRetry,
                    durationMs: Date.now() - attemptStartedAt,
                    ...describeReportError(error),
                  });
                  throw error;
                }
              },
              parseStyleMatchDecision,
              {
                protocol: "style-match",
                onValidationSucceeded: (event) => logProtocolValidation(
                  "info",
                  "protocol.validation_succeeded",
                  {
                    workflowId,
                    phase: currentPhase,
                    capability,
                    protocol: "style-match",
                    ...event,
                  },
                ),
                onValidationFailed: (event) => logProtocolValidation(
                  "warn",
                  "protocol.validation_failed",
                  {
                    workflowId,
                    phase: currentPhase,
                    capability,
                    protocol: "style-match",
                    ...event,
                  },
                ),
              },
            );
            const requestedStyleId = generated.parsed.outcome === "matched"
              ? generated.parsed.styleId
              : null;
            selectedStyle = resolveDesignStyle(designStyles, requestedStyleId);
            selectionSource = generated.parsed.outcome === "no_match"
              ? "default-no-match"
              : selectedStyle?.id === requestedStyleId
                ? "model"
                : "default-invalid-id";
            logReportEvent("info", "capability.completed", {
              workflowId,
              capability,
              phase: currentPhase,
              durationMs: Date.now() - startedAt,
              selectionSource,
              formatAttemptCount: generated.attemptCount,
              ...describeGeneration(generated.generation),
            });
          } catch (error) {
            if (isAbortError(error)) throw error;
            selectedStyle = resolveDesignStyle(designStyles, null);
            selectionSource = "default-error";
            logReportEvent("warn", "capability.failed_with_fallback", {
              workflowId,
              capability,
              phase: currentPhase,
              durationMs: Date.now() - startedAt,
              selectionSource,
              ...describeReportError(error),
            });
          }
        }

        if (!selectedStyle) {
          state.technicalError = "设计风格配置无效，请联系管理员检查默认风格。";
          state.phase = getNextReportPhase(currentPhase, "error");
          break;
        }
        state.styleArtifactId = store.put("style", selectedStyle);
        logReportEvent("info", "design_style.selected", {
          workflowId,
          styleId: selectedStyle.id,
          styleName: selectedStyle.name,
          selectionSource,
          isDefault: selectedStyle.isDefault,
        });
        state.phase = getNextReportPhase(currentPhase, "success");
        break;
      }

      case "research": {
        input.onStage?.(
          "researching",
          getResearchStageLabel(input.userMessage),
        );
        const templateArtifact = store.get(state.templateArtifactId!, "template");
        const generated = await guard(
          state,
          {
            workflowId,
            capability: "report-researcher",
            phase: currentPhase,
          },
          async () => {
            // 只在三条固定演示请求中读取白名单资料；两类远程工具始终保持可用。
            const mockSource = await loadMockReportSource(input.userMessage);
            const prompt = JSON.stringify({
              request: input.userMessage,
              runtimeContext,
              ...templateArtifact,
              mockSource,
            });
            const toolController = createResearchToolController();
            const researcher = createResearchAgent({
              demoSourceAvailable: Boolean(mockSource),
              toolController,
              webSearchTool: createReportWebSearchTool(),
            });
            const attemptStartedAt = Date.now();
            logReportEvent("info", "protocol.generation_started", {
              workflowId,
              phase: currentPhase,
              capability: "report-researcher",
              protocol: "research",
              attemptNumber: 1,
              formatRetry: false,
              recoveryMode: "initial",
            });

            let result: Awaited<ReturnType<typeof researcher.generate>>;
            try {
              result = await researcher.generate({
                abortSignal: input.abortSignal,
                prompt,
                // Research 是多轮工具 Agent，逐轮记录模型状态但不记录提示词或工具正文。
                onStepStart: ({ callId, stepNumber, provider, modelId }) => {
                  logReportEvent("info", "research.model_step_started", {
                    workflowId,
                    attemptNumber: 1,
                    callId,
                    stepNumber,
                    provider,
                    modelId,
                  });
                },
                onStepEnd: (step) => {
                  logReportEvent("info", "research.model_step_completed", {
                    workflowId,
                    attemptNumber: 1,
                    callId: step.callId,
                    stepNumber: step.stepNumber,
                    finishReason: step.finishReason,
                    rawFinishReason: step.rawFinishReason,
                    durationMs: step.performance.stepTimeMs,
                    outputLength: step.text.length,
                    toolCallCount: step.toolCalls.length,
                    toolNames: step.toolCalls
                      .map((call) => call.toolName)
                      .join(",") || undefined,
                    warningCount: step.warnings?.length ?? 0,
                    ...describeUsage(step.usage),
                  });
                },
                // 工具日志只记录名称、标识、耗时和结果类型，不记录参数或返回资料。
                onToolExecutionStart: ({ callId, toolCall }) => {
                  logReportEvent("info", "research.tool_started", {
                    workflowId,
                    attemptNumber: 1,
                    callId,
                    toolCallId: toolCall.toolCallId,
                    toolName: toolCall.toolName,
                  });
                },
                onToolExecutionEnd: ({ callId, toolCall, toolOutput, toolExecutionMs }) => {
                  logReportEvent(
                    toolOutput.type === "tool-error" ? "error" : "info",
                    "research.tool_completed",
                    {
                      workflowId,
                      attemptNumber: 1,
                      callId,
                      toolCallId: toolCall.toolCallId,
                      toolName: toolCall.toolName,
                      durationMs: toolExecutionMs,
                      resultType: toolOutput.type,
                    },
                  );
                },
              });
            } catch (error) {
              logReportEvent("error", "protocol.generation_failed", {
                workflowId,
                phase: currentPhase,
                capability: "report-researcher",
                protocol: "research",
                attemptNumber: 1,
                formatRetry: false,
                recoveryMode: "initial",
                durationMs: Date.now() - attemptStartedAt,
                ...describeReportError(error),
              });
              throw error;
            }

            const toolCallCount = result.steps.reduce(
              (count, step) => count + step.toolCalls.length,
              0,
            );
            const toolStats = toolController.getStats();
            logReportEvent("info", "protocol.generation_completed", {
              workflowId,
              phase: currentPhase,
              capability: "report-researcher",
              protocol: "research",
              attemptNumber: 1,
              formatRetry: false,
              recoveryMode: "initial",
              durationMs: Date.now() - attemptStartedAt,
              finishReason: result.finishReason,
              rawFinishReason: result.rawFinishReason,
              outputLength: result.text.length,
              stepCount: result.steps.length,
              toolCallCount,
              warningCount: result.warnings?.length ?? 0,
              ...toolStats,
              ...describeUsage(result.usage),
            });

            let parsed: ReturnType<typeof parseResearchLedger>;
            let recoveryMode: "none" | "local" = "none";
            let formatAttemptCount = 1;
            let discardedBlockCount = 0;
            const initialDiagnostics = inspectReportTextProtocol(result.text, "research");
            try {
              parsed = parseResearchLedger(result.text);
              logProtocolValidation("info", "protocol.validation_succeeded", {
                workflowId,
                phase: currentPhase,
                capability: "report-researcher",
                protocol: "research",
                attemptNumber: 1,
                formatRetry: false,
                diagnostics: initialDiagnostics,
              });
            } catch (error) {
              if (!(error instanceof ReportTextProtocolFormatError)) throw error;
              logProtocolValidation("warn", "protocol.validation_failed", {
                workflowId,
                phase: currentPhase,
                capability: "report-researcher",
                protocol: "research",
                attemptNumber: 1,
                formatRetry: false,
                diagnostics: initialDiagnostics,
                error,
              });

              input.onStage?.("formatting", "正在本地纠正研究结果格式…");
              const repairStartedAt = Date.now();
              try {
                const repaired = repairResearchProtocolLocally(result.text);
                parsed = repaired.ledger;
                recoveryMode = "local";
                formatAttemptCount = 2;
                discardedBlockCount = repaired.diagnostics.discardedBlockCount;
                logReportEvent("info", "protocol.local_repair_completed", {
                  workflowId,
                  phase: currentPhase,
                  capability: "report-researcher",
                  protocol: "research",
                  durationMs: Date.now() - repairStartedAt,
                  ...repaired.diagnostics,
                });
                logProtocolValidation("info", "protocol.validation_succeeded", {
                  workflowId,
                  phase: currentPhase,
                  capability: "report-researcher",
                  protocol: "research",
                  attemptNumber: 2,
                  formatRetry: true,
                  diagnostics: inspectReportTextProtocol(repaired.text, "research"),
                });
              } catch (repairError) {
                logReportEvent("error", "protocol.local_repair_failed", {
                  workflowId,
                  phase: currentPhase,
                  capability: "report-researcher",
                  protocol: "research",
                  durationMs: Date.now() - repairStartedAt,
                  ...describeReportError(repairError),
                });
                throw repairError;
              }
            }

            const normalized = normalizeResearchLedgerFacts(parsed);
            logReportEvent("info", "research.ledger_normalized", {
              workflowId,
              recoveryMode,
              factCount: normalized.ledger.facts.length,
              discardedBlockCount,
              ...normalized.diagnostics,
            });
            for (const details of createResearchFactBodyLogEntries(
              workflowId,
              normalized.ledger.facts,
            )) {
              logReportEvent("info", "research.fact_body", details);
            }

            return {
              parsed: normalized.ledger,
              modelResult: result,
              recoveryMode,
              formatAttemptCount,
              toolCallCount,
              toolStats,
              discardedBlockCount,
              ...normalized.diagnostics,
            };
          },
          (result) => ({
            finishReason: result.modelResult.finishReason,
            rawFinishReason: result.modelResult.rawFinishReason,
            stepCount: result.modelResult.steps.length,
            outputLength: result.modelResult.text.length,
            formatAttemptCount: result.formatAttemptCount,
            recoveryMode: result.recoveryMode,
            toolCallCount: result.toolCallCount,
            discardedBlockCount: result.discardedBlockCount,
            duplicateFactCount: result.duplicateFactCount,
            truncatedFactCount: result.truncatedFactCount,
            ...result.toolStats,
            ...describeUsage(result.modelResult.usage),
          }),
        );
        const ledger = generated?.parsed;
        if (!ledger) break;
        state.researchArtifactId = store.put("research", ledger);
        state.phase = getNextReportPhase(currentPhase, "success");
        break;
      }

      case "write-draft":
      case "write-repair": {
        const isRepair = currentPhase === "write-repair";

        input.onStage?.(
          isRepair ? "repairing" : "writing",
          isRepair ? "正在执行唯一一次报告修复…" : "正在编写 HTML 报告…",
        );
        const template = store.get(state.templateArtifactId!, "template");
        const designStyle = store.get(state.styleArtifactId!, "style");
        const research = store.get(state.researchArtifactId!, "research");
        const previous = isRepair
          ? store.get(state.reportArtifactId!, "html")
          : undefined;
        const firstReview = isRepair
          ? store.get(state.firstReviewArtifactId!, "review")
          : undefined;
        const generated = await guard(
          state,
          {
            workflowId,
            capability: "report-html-writer",
            phase: currentPhase,
          },
          () =>
            generateReportMarkdownWithRetry((formatRetry) => {
              if (formatRetry) {
                input.onStage?.("formatting", "正在纠正报告输出格式…");
                logReportEvent("warn", "writer.invalid_markdown_retry", {
                  workflowId,
                  phase: currentPhase,
                });
              }
              return generateHtmlReport(designStyle.promptRules, {
                abortSignal: input.abortSignal,
                formatRetry,
                prompt: createReportWriterPrompt({
                  request: input.userMessage,
                  runtimeContext,
                  templateArtifact: template,
                  research,
                  previousHtml: previous?.html,
                  repairInstructions: firstReview?.repairInstructions,
                }),
              });
            }),
          (result) => ({
            finishReason: result.generation.finishReason,
            stepCount: result.generation.steps.length,
            outputLength: result.generation.text.length,
            formatAttemptCount: result.attemptCount,
          }),
        );
        if (!generated) break;
        const { html } = generated.report;
        const title = extractReportTitle(html);
        state.reportArtifactId = store.put("html", {
          title,
          markdown: generated.generation.text,
          html,
          revision: isRepair ? "repair" : "draft",
        });
        state.phase = getNextReportPhase(currentPhase, "success");
        break;
      }

      case "review-draft":
      case "review-repair": {
        const isSecondReview = currentPhase === "review-repair";
        input.onStage?.("reviewing", isSecondReview ? "正在复审修复稿…" : "正在审查报告质量…");
        const template = store.get(state.templateArtifactId!, "template");
        const designStyle = store.get(state.styleArtifactId!, "style");
        const research = store.get(state.researchArtifactId!, "research");
        const report = store.get(state.reportArtifactId!, "html");
        // Reviewer 只检查提取后的 HTML，避免 Markdown 围栏或块外说明干扰内容质量判断。
        const reportForReview = {
          title: report.title,
          html: report.html,
          revision: report.revision,
        };
        const generated = await guard(
          state,
          {
            workflowId,
            capability: "report-quality-reviewer",
            phase: currentPhase,
          },
          () => {
            const prompt = JSON.stringify({
              runtimeContext,
              ...template,
              research: createReportPresentationResearch(research),
              report: reportForReview,
            });
            return generateTextProtocolWithRetry(
              async (formatRetry) => {
                const attemptStartedAt = Date.now();
                logReportEvent("info", "protocol.generation_started", {
                  workflowId,
                  phase: currentPhase,
                  capability: "report-quality-reviewer",
                  protocol: "review",
                  attemptNumber: formatRetry ? 2 : 1,
                  formatRetry,
                });
                try {
                  const result = await generateQualityReview(
                    designStyle.promptRules,
                    {
                      abortSignal: input.abortSignal,
                      formatRetry,
                      prompt,
                    },
                  );
                  logReportEvent("info", "protocol.generation_completed", {
                    workflowId,
                    phase: currentPhase,
                    capability: "report-quality-reviewer",
                    protocol: "review",
                    attemptNumber: formatRetry ? 2 : 1,
                    formatRetry,
                    durationMs: Date.now() - attemptStartedAt,
                    ...describeGeneration(result),
                  });
                  return result;
                } catch (error) {
                  logReportEvent("error", "protocol.generation_failed", {
                    workflowId,
                    phase: currentPhase,
                    capability: "report-quality-reviewer",
                    protocol: "review",
                    attemptNumber: formatRetry ? 2 : 1,
                    formatRetry,
                    durationMs: Date.now() - attemptStartedAt,
                    ...describeReportError(error),
                  });
                  throw error;
                }
              },
              parseReviewResult,
              {
                protocol: "review",
                onValidationSucceeded: (event) => logProtocolValidation(
                  "info",
                  "protocol.validation_succeeded",
                  {
                    workflowId,
                    phase: currentPhase,
                    capability: "report-quality-reviewer",
                    protocol: "review",
                    ...event,
                  },
                ),
                onValidationFailed: (event) => logProtocolValidation(
                  "warn",
                  "protocol.validation_failed",
                  {
                    workflowId,
                    phase: currentPhase,
                    capability: "report-quality-reviewer",
                    protocol: "review",
                    ...event,
                  },
                ),
              },
            );
          },
          (result) => ({
            finishReason: result.generation.finishReason,
            rawFinishReason: result.generation.rawFinishReason,
            stepCount: result.generation.steps.length,
            outputLength: result.generation.text.length,
            formatAttemptCount: result.attemptCount,
            ...describeUsage(result.generation.usage),
          }),
        );
        const review = generated?.parsed;
        if (!review) break;
        const reviewArtifactId = store.put("review", review);

        if (isSecondReview) {
          if (!review.passed) {
            logReportEvent("warn", "review.repair_not_passed", {
              workflowId,
              reviewArtifactId,
              issueCount: review.issues.length,
            });
          }
          state.phase = getNextReportPhase(
            currentPhase,
            review.passed ? "passed" : "rejected",
          );
        } else if (review.passed) {
          state.phase = getNextReportPhase(currentPhase, "passed");
        } else {
          state.firstReviewArtifactId = reviewArtifactId;
          state.phase = getNextReportPhase(currentPhase, "rejected");
        }
        break;
      }

      case "clarify": {
        const clarification = state.clarification;
        if (!clarification) throw new Error("当前没有可返回的澄清问题。");
        state.result = { outcome: "needs_input", ...clarification };
        state.phase = getNextReportPhase(currentPhase, "complete");
        break;
      }

      case "deliver": {
        // 安全处理与可选的 LLM 审查解耦，任何报告在进入浏览器前都必须经过清洗。
        input.onStage?.("sanitizing", "正在执行最终安全处理…");
        try {
          const report = store.get(state.reportArtifactId!, "html");
          const deliveryMarkdown = prepareReportMarkdownForDelivery(
            report.markdown,
            report.html,
          );
          state.result = {
            outcome: "report",
            title: report.title,
            markdown: deliveryMarkdown,
          };
        } catch (error) {
          logReportEvent("error", "sanitize.failed", {
            workflowId,
            phase: state.phase,
            ...describeReportError(error),
          });
          state.result = {
            outcome: "error",
            message: "报告安全处理失败，未生成可预览内容。",
            retryable: true,
          };
        }
        state.phase = getNextReportPhase(currentPhase, "complete");
        break;
      }

      case "fail": {
        state.result = {
          outcome: "error",
          message: state.technicalError || "报告生成服务暂时不可用，请稍后重试。",
          retryable: true,
        };
        state.phase = getNextReportPhase(currentPhase, "complete");
        break;
      }

    }

    totalStepCount += 1;
    logReportEvent("info", "workflow.step_completed", {
      workflowId,
      stepNumber: totalStepCount - 1,
      phase: currentPhase,
      nextPhase: state.phase,
      durationMs: Date.now() - stepStartedAt,
    });
  }

  // 状态机理论上最多执行八步；触及上限说明阶段转换出现了实现缺陷。
  if (!state.result) {
    logReportEvent("error", "workflow.non_terminal_stop", {
      workflowId,
      phase: state.phase,
      finishReason: "max_steps",
      stepCount: totalStepCount,
    });
  }

  const result = state.result ?? {
    outcome: "error",
    message: "报告流程未产生可交付结果，请稍后重试。",
    retryable: true,
  };
  logReportEvent("info", "workflow.completed", {
    workflowId,
    outcome: result.outcome,
    finalPhase: state.phase,
    totalStepCount,
    durationMs: Date.now() - workflowStartedAt,
  });
  return result;
}
