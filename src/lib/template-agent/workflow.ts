import "server-only";

import { createHash, randomUUID } from "node:crypto";
import {
  deepSeek,
  type DeepSeekLanguageModelChatOptions,
} from "@ai-sdk/deepseek";
import { generateText, Output } from "ai";
import { loadGenerateReportGuide } from "./generation-guide";
import {
  completeTemplateContentSchema,
  evaluationSchema,
  getDeterministicValidationIssues,
  getTemplateContentState,
  normalizeTemplateMarkdown,
  normalizeTemplateMarkdownPatch,
  readinessSchema,
  routeDecisionSchema,
  semanticValidationSchema,
  TEMPLATE_FIELD_LABELS,
  templatePatchSchema,
  validateTemplateContent,
} from "./schema";
import {
  getChangedTemplateFields,
  getTemplateAgentSnapshot,
  updateTemplateAgentSnapshot,
} from "./repository";
import {
  buildAdjustmentOptimizationPrompt,
  buildEvaluationPrompt,
  buildGenerationOptimizationPrompt,
  buildGenerationReadinessPrompt,
  buildRequestRoutingPrompt,
  buildTemplateAdjustmentPrompt,
  buildTemplateGenerationPrompt,
  buildTemplateValidationPrompt,
} from "./prompts";
import type {
  TemplateAgentAttachment,
  TemplateAgentConfirmation,
  TemplateAgentContent,
  TemplateAgentField,
  TemplateAgentResult,
} from "./types";

const MAX_ATTACHMENT_BYTES = 1024 * 1024;
const MAX_OPTIMIZATION_ROUNDS = 2;
const MODEL_TIMEOUT_MS = 90_000;
const MAX_OUTPUT_TOKENS = 393_216;
const SUPPORTED_ATTACHMENT_PATTERN = /\.(md|html)$/i;
const MODEL_DIAGNOSTICS_ENABLED = process.env.NODE_ENV === "development";

type ConversationItem = { role: "user" | "assistant"; content: string };

/** 路由层传入 Workflow 的完整上下文；onStage 仅用于向前端报告进度。 */
export type RunTemplateAgentInput = {
  templateId: string;
  operation: "chat" | "validate";
  userMessage: string;
  history: ConversationItem[];
  attachment?: TemplateAgentAttachment;
  confirmation?: TemplateAgentConfirmation;
  abortSignal?: AbortSignal;
  onStage?: (stage: string, label: string) => void;
};

const model = () => deepSeek(process.env.DEEPSEEK_MODEL ?? "deepseek-flash");

/**
 * 统一模型调用参数，确保每个阶段使用相同的模型、超时和输出预算。
 * 用户中止信号与服务端超时信号合并，任一触发都会终止当前模型请求。
 */
const callOptions = (
  abortSignal: AbortSignal | undefined,
  thinking: "enabled" | "disabled",
) => ({
  model: model(),
  abortSignal: abortSignal
    ? AbortSignal.any([abortSignal, AbortSignal.timeout(MODEL_TIMEOUT_MS)])
    : AbortSignal.timeout(MODEL_TIMEOUT_MS),
  // DeepSeek 的最大输出预算为 384K，推理内容与最终回答共同占用该预算。
  maxOutputTokens: MAX_OUTPUT_TOKENS,
  // 每个 Workflow 阶段都显式声明是否启用深度推理，避免继承模型侧默认值。
  providerOptions: {
    deepseek: {
      thinking: { type: thinking },
    } satisfies DeepSeekLanguageModelChatOptions,
  },
});

/**
 * 开发环境记录模型的原始文本和结构化结果，方便定位 JSON 解析、Schema 校验与截断问题。
 * 生产环境完全跳过序列化，避免业务内容进入生产日志并减少运行开销。
 */
const runModelCall = async <Result>(
  stage: string,
  execute: () => Promise<Result>,
): Promise<Result> => {
  if (!MODEL_DIAGNOSTICS_ENABLED) return execute();

  const callId = randomUUID();
  const startedAt = Date.now();
  console.info(`[template-agent:model:start] ${toDiagnosticJson({ callId, stage })}`);

  try {
    const result = await execute();
    const details = result as Record<string, unknown>;
    console.info(
      `[template-agent:model:success] ${toDiagnosticJson({
        callId,
        stage,
        durationMs: Date.now() - startedAt,
        text: details.text,
        output: details.output,
        finishReason: details.finishReason,
        rawFinishReason: details.rawFinishReason,
        usage: details.usage,
        warnings: details.warnings,
        response: details.response,
        providerMetadata: details.providerMetadata,
      })}`,
    );
    return result;
  } catch (error) {
    console.error(
      `[template-agent:model:error] ${toDiagnosticJson({
        callId,
        stage,
        durationMs: Date.now() - startedAt,
        error: serializeDiagnosticError(error),
      })}`,
    );
    throw error;
  }
};

/** 诊断输出不能反过来影响 Workflow；循环引用和 bigint 都降级为可读文本。 */
function toDiagnosticJson(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === "bigint") return item.toString();
      if (item instanceof Error) return serializeDiagnosticError(item);
      if (typeof item === "object" && item !== null) {
        if (seen.has(item)) return "[circular]";
        seen.add(item);
      }
      return item;
    });
  } catch (error) {
    return JSON.stringify({
      diagnosticSerializationError:
        error instanceof Error ? error.message : String(error),
    });
  }
}

/** Error 的关键字段通常不可枚举，必须显式读取属性和 cause 链。 */
function serializeDiagnosticError(error: unknown, depth = 0): unknown {
  if (depth >= 6) return "[cause chain truncated]";
  if (!(error instanceof Error)) return error;

  const details: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  for (const property of Object.getOwnPropertyNames(error)) {
    if (property === "stack" || property === "message") continue;
    try {
      details[property] = (error as unknown as Record<string, unknown>)[
        property
      ];
    } catch {
      details[property] = "[unreadable]";
    }
  }
  if (error.cause !== undefined) {
    details.cause = serializeDiagnosticError(error.cause, depth + 1);
  }
  return details;
}

/**
 * 同时校验客户端声明的大小和服务端实际 UTF-8 字节数，防止伪造 size 绕过限制。
 * 当前只允许能够直接作为文本送入模型的 Markdown 与 HTML 文件。
 */
const validateAttachment = (
  attachment?: TemplateAgentAttachment,
): string | null => {
  if (!attachment) return null;
  if (!SUPPORTED_ATTACHMENT_PATTERN.test(attachment.name)) {
    return "参考文件只支持 .md 或 .html。";
  }
  if (attachment.size <= 0 || attachment.size > MAX_ATTACHMENT_BYTES) {
    return "参考文件必须为非空文件，且不能超过 1 MiB。";
  }
  if (Buffer.byteLength(attachment.content, "utf8") > MAX_ATTACHMENT_BYTES) {
    return "参考文件文本不能超过 1 MiB。";
  }
  return null;
};

/**
 * 将确认动作绑定到模板版本和原始请求。
 * 用户确认后若模板、消息或附件发生变化，摘要将不一致，旧确认不会被复用。
 */
const getRequestFingerprint = (
  templateId: string,
  revision: number,
  userMessage: string,
  attachment?: TemplateAgentAttachment,
) =>
  createHash("sha256")
    .update(templateId)
    .update("\0")
    .update(String(revision))
    .update("\0")
    .update(userMessage)
    .update("\0")
    .update(attachment?.name ?? "")
    .update("\0")
    .update(attachment?.content ?? "")
    .digest("hex");

/** 将局部补丁合并到数据库快照；null 的明确语义是保留该字段原值。 */
const mergePatch = (
  current: TemplateAgentContent,
  patch: {
    [Field in TemplateAgentField]: TemplateAgentContent[Field] | null;
  },
): TemplateAgentContent => ({
  name: patch.name ?? current.name,
  description: patch.description ?? current.description,
  variables: patch.variables ?? current.variables,
  explainStructure: patch.explainStructure ?? current.explainStructure,
  consistencyRules: patch.consistencyRules ?? current.consistencyRules,
  constraintRules: patch.constraintRules ?? current.constraintRules,
  exceptionBoundaryRules:
    patch.exceptionBoundaryRules ?? current.exceptionBoundaryRules,
  verificationRules: patch.verificationRules ?? current.verificationRules,
});

/** 把内部字段名转换为适合直接展示给用户的中文摘要。 */
const summarizeChangedFields = (fields: TemplateAgentField[]) =>
  fields.map((field) => TEMPLATE_FIELD_LABELS[field]).join("、");

/** 合并并去重评价反馈，保证下一轮优化始终能收到至少一条可执行指令。 */
const getEvaluationFeedback = (evaluation: {
  blockingIssues: string[];
  fixInstructions: string[];
}) => {
  const feedback = [
    ...evaluation.blockingIssues,
    ...evaluation.fixInstructions,
  ];
  return feedback.length > 0
    ? [...new Set(feedback)]
    : ["重新核对用户要求与字段标准，并修正导致评价未通过的问题。"];
};

/**
 * 使用独立的评价模型检查候选结果，但不允许该阶段直接修改模板。
 * generate 会评价完整模板；adjust 还会额外检查是否误改了用户未要求的字段。
 */
async function evaluateCandidate({
  operation,
  userMessage,
  attachment,
  original,
  candidate,
  generationGuide,
  abortSignal,
}: {
  operation: "generate" | "adjust";
  userMessage: string;
  attachment?: TemplateAgentAttachment;
  original: TemplateAgentContent;
  candidate: TemplateAgentContent;
  generationGuide?: string;
  abortSignal?: AbortSignal;
}) {
  const messages = buildEvaluationPrompt({
    operation,
    userMessage,
    attachment,
    original,
    candidate,
    generationGuide,
  });
  const { output } = await runModelCall(`evaluate-${operation}`, () =>
    generateText({
      ...callOptions(abortSignal, "enabled"),
      output: Output.object({ schema: evaluationSchema }),
      ...messages,
    }),
  );
  return output;
}

/** 根据上一轮评价反馈修正完整生成结果，并统一规范所有 Markdown 换行。 */
async function optimizeGeneratedCandidate({
  userMessage,
  attachment,
  candidate,
  feedback,
  generationGuide,
  abortSignal,
}: {
  userMessage: string;
  attachment?: TemplateAgentAttachment;
  candidate: TemplateAgentContent;
  feedback: string[];
  generationGuide: string;
  abortSignal?: AbortSignal;
}) {
  const messages = buildGenerationOptimizationPrompt({
    userMessage,
    attachment,
    candidate,
    feedback,
    generationGuide,
  });
  const { output } = await runModelCall("optimize-generation", () =>
    generateText({
      ...callOptions(abortSignal, "disabled"),
      output: Output.object({ schema: completeTemplateContentSchema }),
      ...messages,
    }),
  );
  return normalizeTemplateMarkdown(output);
}

/**
 * 完整生成流程：先判断资料是否充分，再生成八字段模板，最后通过评价—修正循环收敛质量。
 * 返回 TemplateAgentContent 表示可以进入最终校验；返回 TemplateAgentResult 表示需要提前结束。
 */
async function runGenerateWorkflow({
  userMessage,
  attachment,
  current,
  renameRequested,
  abortSignal,
  onStage,
}: {
  userMessage: string;
  attachment?: TemplateAgentAttachment;
  current: TemplateAgentContent;
  renameRequested: boolean;
  abortSignal?: AbortSignal;
  onStage?: RunTemplateAgentInput["onStage"];
}): Promise<TemplateAgentContent | TemplateAgentResult> {
  onStage?.("readiness", "正在检查资料完整性…");
  // 先让模型识别关键信息缺口，避免在输入不足时直接生成并虚构业务规则。
  const readinessMessages = buildGenerationReadinessPrompt({
    userMessage,
    attachment,
  });
  const { output: readiness } = await runModelCall("generation-readiness", () =>
    generateText({
      ...callOptions(abortSignal, "enabled"),
      output: Output.object({ schema: readinessSchema }),
      ...readinessMessages,
    }),
  );

  if (!readiness.ready) {
    return {
      outcome: "needs_input",
      databaseUpdated: false,
      message: readiness.message,
      missingItems: readiness.missingItems,
    };
  }

  onStage?.("loading-guide", "正在加载完整生成规范…");
  let generationGuide: string;
  try {
    // 在资料确认可生成后只读取一次，并让初稿、评价和每轮修正共享同一份规范。
    generationGuide = await loadGenerateReportGuide();
  } catch (error) {
    console.error("Failed to load complete generation guide.", error);
    return {
      outcome: "error",
      databaseUpdated: false,
      message: "完整生成规范不可用，数据库没有被修改。请联系管理员检查提示词文件。",
      retryable: false,
    };
  }

  onStage?.("generating", "正在生成完整模板…");
  // Output.object 在模型输出边界直接套用完整 Schema，拒绝缺字段或类型错误的结果。
  const generationMessages = buildTemplateGenerationPrompt({
    userMessage,
    currentName: current.name,
    attachment,
    generationGuide,
  });
  const { output } = await runModelCall("generate-template", () =>
    generateText({
      ...callOptions(abortSignal, "disabled"),
      output: Output.object({ schema: completeTemplateContentSchema }),
      ...generationMessages,
    }),
  );

  // 草稿名称属于用户显式输入；除非用户要求改名，否则不让完整生成静默覆盖。
  const normalizedOutput = normalizeTemplateMarkdown(output);
  let candidate: TemplateAgentContent = {
    ...normalizedOutput,
    name: current.name.trim() && !renameRequested ? current.name : output.name,
  };

  // round=0 评价初稿，后续轮次评价修正稿；达到上限后不再把不可靠结果交给写库流程。
  for (let round = 0; round <= MAX_OPTIMIZATION_ROUNDS; round += 1) {
    onStage?.("evaluating", `正在进行第 ${round + 1} 轮质量检查…`);
    const evaluation = await evaluateCandidate({
      operation: "generate",
      userMessage,
      attachment,
      original: current,
      candidate,
      generationGuide,
      abortSignal,
    });
    if (evaluation.passed && evaluation.blockingIssues.length === 0) {
      return candidate;
    }

    if (round === MAX_OPTIMIZATION_ROUNDS) {
      return {
        outcome: "needs_input",
        databaseUpdated: false,
        message: "候选模板经过两轮修正后仍未达到可交付标准，请补充或收紧要求。",
        missingItems: getEvaluationFeedback(evaluation),
      };
    }

    onStage?.("optimizing", "正在根据质量反馈修正模板…");
    candidate = await optimizeGeneratedCandidate({
      userMessage,
      attachment,
      candidate,
      feedback: getEvaluationFeedback(evaluation),
      generationGuide,
      abortSignal,
    });
    if (current.name.trim() && !renameRequested) candidate.name = current.name;
  }

  return candidate;
}

/**
 * 局部调整流程只生成最小字段补丁，再将补丁与原快照合并后评价。
 * 每轮优化都重新生成补丁，避免评价器的建议导致无关字段被连带重写。
 */
async function runAdjustWorkflow({
  userMessage,
  current,
  renameRequested,
  abortSignal,
  onStage,
}: {
  userMessage: string;
  current: TemplateAgentContent;
  renameRequested: boolean;
  abortSignal?: AbortSignal;
  onStage?: RunTemplateAgentInput["onStage"];
}): Promise<TemplateAgentContent | TemplateAgentResult> {
  onStage?.("adjusting", "正在生成最小修改补丁…");
  // Schema 要求八个键全部存在，并用 null 明确表示“不修改”，降低模型输出歧义。
  const adjustmentMessages = buildTemplateAdjustmentPrompt({
    userMessage,
    current,
  });
  const { output: initialPatch } = await runModelCall("adjust-template", () =>
    generateText({
      ...callOptions(abortSignal, "disabled"),
      output: Output.object({ schema: templatePatchSchema }),
      ...adjustmentMessages,
    }),
  );

  // 即使模型擅自返回新名称，也只有路由阶段确认用户明确要求改名后才会采用。
  let patch = {
    ...normalizeTemplateMarkdownPatch(initialPatch),
    name: renameRequested ? initialPatch.name : null,
  };
  let candidate = mergePatch(current, patch);

  for (let round = 0; round <= MAX_OPTIMIZATION_ROUNDS; round += 1) {
    onStage?.("evaluating", `正在进行第 ${round + 1} 轮调整检查…`);
    const evaluation = await evaluateCandidate({
      operation: "adjust",
      userMessage,
      original: current,
      candidate,
      abortSignal,
    });
    if (evaluation.passed && evaluation.blockingIssues.length === 0) {
      return candidate;
    }

    if (round === MAX_OPTIMIZATION_ROUNDS) {
      return {
        outcome: "needs_input",
        databaseUpdated: false,
        message: "调整结果经过两轮修正后仍无法可靠满足要求，请补充更明确的修改方向。",
        missingItems: getEvaluationFeedback(evaluation),
      };
    }

    onStage?.("optimizing", "正在根据质量反馈修正调整补丁…");
    const optimizationMessages = buildAdjustmentOptimizationPrompt({
      userMessage,
      current,
      patch,
      candidate,
      feedback: getEvaluationFeedback(evaluation),
    });
    const { output: nextPatch } = await runModelCall("optimize-adjustment", () =>
      generateText({
        ...callOptions(abortSignal, "disabled"),
        output: Output.object({ schema: templatePatchSchema }),
        ...optimizationMessages,
      }),
    );
    patch = {
      ...normalizeTemplateMarkdownPatch(nextPatch),
      name: renameRequested ? nextPatch.name : null,
    };
    candidate = mergePatch(current, patch);
  }

  return candidate;
}

/**
 * 只读验证由两层组成：程序负责可确定的结构规则，LLM 负责字段语义和跨字段一致性。
 * 该流程不进入保存分支，因此验证操作不会修改数据库。
 */
async function runValidationWorkflow(
  current: TemplateAgentContent,
  onStage?: RunTemplateAgentInput["onStage"],
  abortSignal?: AbortSignal,
): Promise<TemplateAgentResult> {
  onStage?.("validating", "正在验证模板结构和字段语义…");
  // 先运行稳定、可复现的本地校验，再把结果提供给语义模型用于补充而非重复。
  const deterministicIssues = getDeterministicValidationIssues(current);
  const validationMessages = buildTemplateValidationPrompt({
    current,
    deterministicIssues,
  });
  const { output } = await runModelCall("validate-template", () =>
    generateText({
      ...callOptions(abortSignal, "disabled"),
      output: Output.object({ schema: semanticValidationSchema }),
      ...validationMessages,
    }),
  );

  // 模型声明失败却未解释原因时补充兜底问题，避免返回“未通过但无详情”的矛盾状态。
  const issues = [...deterministicIssues, ...output.issues];
  if (!output.valid && output.issues.length === 0) {
    issues.push({
      field: "template",
      reason: "语义验证未通过，但模型没有返回具体问题。",
      suggestion: "请重新验证；若问题持续出现，请逐项检查字段语义和跨字段一致性。",
    });
  }
  const valid = issues.length === 0 && output.valid;
  return {
    outcome: "validated",
    databaseUpdated: false,
    valid,
    issues,
    message: valid
      ? "验证通过：模板结构完整，字段语义和内容边界符合标准。"
      : `验证未通过，共发现 ${issues.length} 个需要处理的问题。`,
  };
}

/**
 * 受控 Workflow 的唯一入口。
 * 所有分支都从同一数据库快照开始，并在最终写入时再次使用 revision 做并发保护。
 */
export async function runTemplateAgent(
  input: RunTemplateAgentInput,
): Promise<TemplateAgentResult> {
  input.onStage?.("loading", "正在读取数据库最新模板…");
  const snapshot = await getTemplateAgentSnapshot(input.templateId);
  if (!snapshot) {
    return {
      outcome: "error",
      databaseUpdated: false,
      message: "模板不存在或已被删除。",
      retryable: false,
    };
  }

  // 验证是只读操作，无需附件校验、意图路由或用户确认。
  if (input.operation === "validate") {
    return runValidationWorkflow(
      snapshot.content,
      input.onStage,
      input.abortSignal,
    );
  }

  // 在附件进入任何 Prompt 前完成格式和大小校验。
  const attachmentError = validateAttachment(input.attachment);
  if (attachmentError) {
    return {
      outcome: "needs_input",
      databaseUpdated: false,
      message: attachmentError,
      missingItems: [attachmentError],
    };
  }
  // 聊天操作至少需要自然语言要求或可供分析的参考附件。
  if (!input.userMessage.trim() && !input.attachment) {
    return {
      outcome: "needs_input",
      databaseUpdated: false,
      message: "请输入生成或调整要求，或上传一个参考文件。",
      missingItems: ["用户要求或参考文件"],
    };
  }

  // 模板状态由六个关键内容字段决定，用于约束“生成”与“调整”的合法组合。
  const state = getTemplateContentState(snapshot.content);
  const fingerprint = getRequestFingerprint(
    input.templateId,
    snapshot.revision,
    input.userMessage,
    input.attachment,
  );

  let route: "generate" | "adjust";
  let renameRequested = false;
  let effectiveAttachment = input.attachment;

  // 确认请求沿用此前已经判定的动作；普通请求才需要调用 LLM 识别意图。
  if (input.confirmation) {
    // revision 防止覆盖并发修改，fingerprint 防止确认被套用到另一份请求或附件。
    if (
      input.confirmation.revision !== snapshot.revision ||
      input.confirmation.fingerprint !== fingerprint
    ) {
      return {
        outcome: "error",
        databaseUpdated: false,
        message: "模板或请求内容已发生变化，原确认已失效，请重新发送。",
        retryable: true,
      };
    }
    route = input.confirmation.action === "overwrite" ? "generate" : "adjust";
    renameRequested = input.confirmation.renameRequested;
    if (input.confirmation.action === "adjust_without_attachment") {
      effectiveAttachment = undefined;
    }
  } else {
    input.onStage?.("routing", "正在判断生成或调整意图…");
    // 路由模型只输出结构化决策，不在此阶段生成任何模板内容。
    const routingMessages = buildRequestRoutingPrompt({
      state,
      existingFields: Object.entries(snapshot.content)
        .filter(([, value]) =>
          Array.isArray(value) ? value.length > 0 : Boolean(value.trim()),
        )
        .map(([field]) => field),
      hasAttachment: Boolean(input.attachment),
      history: input.history,
      userMessage: input.userMessage,
    });
    const { output: decision } = await runModelCall("route-request", () =>
      generateText({
        ...callOptions(input.abortSignal, "enabled"),
        output: Output.object({ schema: routeDecisionSchema }),
        ...routingMessages,
      }),
    );
    renameRequested = decision.renameRequested;

    // 不确定时向用户澄清，不根据模糊表达猜测并修改数据库。
    if (decision.route === "clarify") {
      return {
        outcome: "needs_input",
        databaseUpdated: false,
        message: decision.question ?? decision.reason,
        missingItems: [decision.reason],
      };
    }
    route = decision.route;

    // 空模板没有可供局部修改的基线，只能要求用户补充生成信息。
    if (route === "adjust" && state === "empty") {
      return {
        outcome: "needs_input",
        databaseUpdated: false,
        message: "当前模板还没有可调整内容。请说明希望生成的模板用途和结构。",
        missingItems: ["可作为调整基础的模板内容"],
      };
    }

    // 完整生成会覆盖已有内容，因此必须先返回带版本绑定的二次确认。
    if (route === "generate" && state !== "empty") {
      return {
        outcome: "confirmation_required",
        databaseUpdated: false,
        message: "当前模板已有内容，重新生成可能覆盖现有模板。请选择后续操作。",
        confirmation: {
          kind: "overwrite",
          revision: snapshot.revision,
          fingerprint,
          renameRequested,
        },
      };
    }

    // 附件只参与完整生成；调整场景由用户决定改为覆盖生成还是忽略附件。
    if (route === "adjust" && input.attachment) {
      return {
        outcome: "confirmation_required",
        databaseUpdated: false,
        message: "附件仅用于完整生成。请选择重新生成并覆盖，或忽略附件后调整当前模板。",
        confirmation: {
          kind: "attachment_adjust",
          revision: snapshot.revision,
          fingerprint,
          renameRequested,
        },
      };
    }
  }

  // 根据已确认的用户意图运行对应工作流；此时仍只产生内存中的候选内容。
  const workflowResult = route === "generate"
    ? await runGenerateWorkflow({
        userMessage: input.userMessage,
        attachment: effectiveAttachment,
        current: snapshot.content,
        renameRequested,
        abortSignal: input.abortSignal,
        onStage: input.onStage,
      })
    : await runAdjustWorkflow({
        userMessage: input.userMessage,
        current: snapshot.content,
        renameRequested,
        abortSignal: input.abortSignal,
        onStage: input.onStage,
      });

  // 子流程的业务结果（如资料不足）直接返回，只有候选模板才继续进入保存链路。
  if ("outcome" in workflowResult) return workflowResult;

  input.onStage?.("checking", "正在执行最终字段校验…");
  // 写库前再次响应用户取消，避免已经终止的请求继续产生持久化副作用。
  input.abortSignal?.throwIfAborted();
  // 最终确定性校验是写库硬门槛，不能只依赖 LLM 自评结果。
  const validated = validateTemplateContent(workflowResult);
  if (!validated.success) {
    return {
      outcome: "error",
      databaseUpdated: false,
      message: `候选模板未通过最终校验：${validated.issues.map((issue) => issue.reason).join("；")}`,
      retryable: true,
    };
  }

  const changedFields = getChangedTemplateFields(
    snapshot.content,
    validated.data,
  );
  // 没有实际字段变化时跳过 UPDATE，避免产生无意义的新 revision 和版本快照。
  if (changedFields.length === 0) {
    return {
      outcome: "unchanged",
      databaseUpdated: false,
      message: "当前模板已经符合这项要求，没有需要保存的变更。",
    };
  }

  input.onStage?.("saving", "正在原子更新数据库…");
  input.abortSignal?.throwIfAborted();
  // repository 使用读取时的 revision 作为更新条件，防止覆盖 Workflow 执行期间的人工修改。
  const updated = await updateTemplateAgentSnapshot(
    snapshot.id,
    snapshot.revision,
    validated.data,
  );
  if (updated.status === "conflict") {
    return {
      outcome: "error",
      databaseUpdated: false,
      message: "Agent 处理期间模板已被修改，本次结果未覆盖新版本，请重新发送。",
      retryable: true,
    };
  }

  return {
    outcome: "updated",
    databaseUpdated: true,
    revision: updated.revision,
    changedFields,
    message: `已按照您的要求更新了模板内容，请在页面中查看。本次修改了：${summarizeChangedFields(changedFields)}。`,
  };
}
