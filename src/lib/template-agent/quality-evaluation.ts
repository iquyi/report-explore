import { NoObjectGeneratedError } from "ai";
import { TEMPLATE_FIELD_LABELS } from "./field-labels";

/** 0 表示完全跳过模型评价与优化；正数表示最多执行相同次数的“评价—优化”。 */
export const MAX_OPTIMIZATION_ROUNDS = 0;
export const MAX_EVALUATION_OUTPUT_RETRIES = 1;

/** 模型评价阶段返回的原始结构；每一项都会原样参与下一轮优化反馈。 */
export type TemplateEvaluationOutput = {
  passed: boolean;
  blockingIssues: string[];
  fixInstructions: string[];
};

/** 随成功或无变化结果返回的最终质量评价，供消息流完整展示。 */
export type TemplateQualityEvaluation = TemplateEvaluationOutput & {
  evaluationAttempt: number;
};

export type TemplateEvaluationDecision = {
  action: "accept" | "optimize" | "optimize_and_accept";
  qualityEvaluation: TemplateQualityEvaluation;
};

/** 生成从 1 开始的评价次数；0 轮返回空数组，从而完全跳过模型评价。 */
export const getTemplateEvaluationAttempts = (maxRounds: number): number[] => {
  if (!Number.isInteger(maxRounds) || maxRounds < 0) {
    throw new Error("最大优化次数必须是非负整数。");
  }
  return Array.from({ length: maxRounds }, (_item, index) => index + 1);
};

/**
 * 把评价次数转换为明确的工作流动作。
 *
 * evaluationAttempt 从 1 开始；达到最后一次仍未通过时，先执行本轮优化，
 * 再直接交付优化后的候选，避免额外进行第 maxRounds + 1 次评价。
 */
export const resolveTemplateEvaluation = ({
  evaluation,
  evaluationAttempt,
  maxRounds,
}: {
  evaluation: TemplateEvaluationOutput;
  evaluationAttempt: number;
  maxRounds: number;
}): TemplateEvaluationDecision => {
  if (!Number.isInteger(maxRounds) || maxRounds < 0) {
    throw new Error("最大优化次数必须是非负整数。");
  }
  if (
    !Number.isInteger(evaluationAttempt) ||
    evaluationAttempt < 1 ||
    evaluationAttempt > maxRounds
  ) {
    throw new Error("评价次数必须是最大优化次数范围内的正整数。");
  }

  // 模型声明通过但同时返回阻塞问题时，按未通过处理，避免结果自相矛盾。
  const passed = evaluation.passed && evaluation.blockingIssues.length === 0;
  const qualityEvaluation: TemplateQualityEvaluation = {
    evaluationAttempt,
    passed,
    blockingIssues: [...evaluation.blockingIssues],
    fixInstructions: [...evaluation.fixInstructions],
  };

  return {
    action: passed
      ? "accept"
      : evaluationAttempt === maxRounds
        ? "optimize_and_accept"
        : "optimize",
    qualityEvaluation,
  };
};

/**
 * 质量评价的结构化输出发生解析或 Schema 校验错误时只重试一次。
 * 超时、网络错误和用户取消不会进入这里的重试分支，避免扩大调用次数。
 */
export async function runEvaluationWithStructuredOutputRetry<Result>({
  execute,
  abortSignal,
  onRetry,
}: {
  execute: (retryAttempt: number) => Promise<Result>;
  abortSignal?: AbortSignal;
  onRetry?: (retryAttempt: number) => void;
}): Promise<Result> {
  for (
    let retryAttempt = 0;
    retryAttempt <= MAX_EVALUATION_OUTPUT_RETRIES;
    retryAttempt += 1
  ) {
    abortSignal?.throwIfAborted();

    try {
      return await execute(retryAttempt);
    } catch (error) {
      const canRetry =
        retryAttempt < MAX_EVALUATION_OUTPUT_RETRIES &&
        NoObjectGeneratedError.isInstance(error);
      if (!canRetry) throw error;

      // 解析失败与用户取消可能同时发生；重试前再次检查，确保取消优先。
      abortSignal?.throwIfAborted();
      onRetry?.(retryAttempt + 1);
    }
  }

  throw new Error("质量评价结构化输出重试循环意外结束。");
}

/**
 * 用户可见评价不得泄露数据库字段名。最长字段名优先替换，并同时覆盖应用层
 * camelCase 与指南中的 snake_case，避免短名称先替换后破坏长名称匹配。
 */
const USER_VISIBLE_FIELD_REPLACEMENTS = [
  ["exceptionBoundaryRules", TEMPLATE_FIELD_LABELS.exceptionBoundaryRules],
  ["exception_boundary_rules", TEMPLATE_FIELD_LABELS.exceptionBoundaryRules],
  ["verificationRules", TEMPLATE_FIELD_LABELS.verificationRules],
  ["verification_rules", TEMPLATE_FIELD_LABELS.verificationRules],
  ["consistencyRules", TEMPLATE_FIELD_LABELS.consistencyRules],
  ["consistency_rules", TEMPLATE_FIELD_LABELS.consistencyRules],
  ["explainStructure", TEMPLATE_FIELD_LABELS.explainStructure],
  ["explain_structure", TEMPLATE_FIELD_LABELS.explainStructure],
  ["constraintRules", TEMPLATE_FIELD_LABELS.constraintRules],
  ["constraint_rules", TEMPLATE_FIELD_LABELS.constraintRules],
  ["description", TEMPLATE_FIELD_LABELS.description],
  ["variables", TEMPLATE_FIELD_LABELS.variables],
  ["name", TEMPLATE_FIELD_LABELS.name],
] as const;

/** 把一段模型反馈中的数据库字段名替换为对应中文名称。 */
export const localizeTemplateFieldNames = (value: string): string =>
  USER_VISIBLE_FIELD_REPLACEMENTS.reduce(
    (localized, [field, label]) =>
      localized.replace(new RegExp(`\\b${field}\\b`, "g"), label),
    value,
  );

/** 在评价进入消息流前复制并本地化文本，内部优化流程仍可使用原始反馈。 */
export const localizeQualityEvaluation = (
  evaluation: TemplateQualityEvaluation,
): TemplateQualityEvaluation => ({
  ...evaluation,
  blockingIssues: evaluation.blockingIssues.map(localizeTemplateFieldNames),
  fixInstructions: evaluation.fixInstructions.map(localizeTemplateFieldNames),
});

/** 将结构化质量评价完整格式化为消息流文本，同时保留没有详情时的兜底提醒。 */
export const formatQualityEvaluationReply = (
  message: string,
  evaluation: TemplateQualityEvaluation,
): string => {
  const sections = [
    message,
    `\n质量评价：${evaluation.passed ? "通过" : "未通过"}（第 ${evaluation.evaluationAttempt} 次评价）`,
  ];

  if (evaluation.blockingIssues.length > 0) {
    sections.push(
      `\n发现的问题：\n${evaluation.blockingIssues.map((item) => `- ${item}`).join("\n")}`,
    );
  }
  if (evaluation.fixInstructions.length > 0) {
    sections.push(
      `\n调整建议：\n${evaluation.fixInstructions.map((item) => `- ${item}`).join("\n")}`,
    );
  }
  if (
    !evaluation.passed &&
    evaluation.blockingIssues.length === 0 &&
    evaluation.fixInstructions.length === 0
  ) {
    sections.push("\n评价模型未返回具体问题，请按模板规范手动复核各字段。");
  }

  return sections.join("\n");
};
