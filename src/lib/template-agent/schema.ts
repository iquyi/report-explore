import { z } from "zod";
import { TEMPLATE_FIELD_LIMITS } from "./limits";
import type {
  TemplateAgentContent,
  TemplateAgentField,
  TemplateContentState,
  TemplateValidationIssue,
} from "./types";

export const TEMPLATE_FIELD_LABELS: Record<TemplateAgentField, string> = {
  name: "模板名称",
  description: "用途描述",
  variables: "模板变量",
  explainStructure: "报告结构",
  consistencyRules: "一致性规则",
  constraintRules: "核心约束",
  exceptionBoundaryRules: "异常边界处理",
  verificationRules: "交付校验规则",
};

export const TEMPLATE_CONTENT_FIELDS = Object.keys(
  TEMPLATE_FIELD_LABELS,
) as TemplateAgentField[];

export const TEMPLATE_KEY_FIELDS = [
  "variables",
  "explainStructure",
  "consistencyRules",
  "constraintRules",
  "exceptionBoundaryRules",
  "verificationRules",
] as const satisfies readonly TemplateAgentField[];

const TEMPLATE_REQUIRED_TEXT_FIELDS = [
  "explainStructure",
  "consistencyRules",
  "constraintRules",
  "exceptionBoundaryRules",
  "verificationRules",
] as const satisfies readonly TemplateAgentField[];

export const variableSchema = z.object({
  key: z.string().trim().min(1).max(TEMPLATE_FIELD_LIMITS.variableKey),
  // Markdown 末尾 LF 属于字段内容，不能使用 trim() 在结构化解析时移除。
  value: z.string().min(1).max(TEMPLATE_FIELD_LIMITS.variableValue),
});

/** 普通模板允许用户主动清空规则；完整生成使用下方更严格的 Schema。 */
export const templateContentSchema = z.object({
  name: z.string().trim().min(1).max(TEMPLATE_FIELD_LIMITS.name),
  description: z.string().max(TEMPLATE_FIELD_LIMITS.description),
  variables: z.array(variableSchema),
  explainStructure: z.string().max(TEMPLATE_FIELD_LIMITS.explainStructure),
  consistencyRules: z.string().max(TEMPLATE_FIELD_LIMITS.consistencyRules),
  constraintRules: z.string().max(TEMPLATE_FIELD_LIMITS.constraintRules),
  exceptionBoundaryRules: z.string().max(
    TEMPLATE_FIELD_LIMITS.exceptionBoundaryRules,
  ),
  verificationRules: z.string().max(TEMPLATE_FIELD_LIMITS.verificationRules),
});

export const completeTemplateContentSchema = templateContentSchema.extend({
  description: z.string().trim().min(1).max(TEMPLATE_FIELD_LIMITS.description),
  // 非空 Markdown 字段保留原始换行，空白语义由最终确定性校验负责。
  explainStructure: z.string().min(1).max(TEMPLATE_FIELD_LIMITS.explainStructure),
  consistencyRules: z.string().min(1).max(TEMPLATE_FIELD_LIMITS.consistencyRules),
  constraintRules: z.string().min(1).max(TEMPLATE_FIELD_LIMITS.constraintRules),
  exceptionBoundaryRules: z.string().min(1).max(
    TEMPLATE_FIELD_LIMITS.exceptionBoundaryRules,
  ),
  verificationRules: z.string().min(1).max(TEMPLATE_FIELD_LIMITS.verificationRules),
});

export const routeDecisionSchema = z.object({
  route: z.enum(["generate", "adjust", "clarify"]),
  reason: z.string().trim().min(1).max(500),
  question: z.string().trim().max(500).nullable(),
  renameRequested: z.boolean(),
});

export const readinessSchema = z.object({
  ready: z.boolean(),
  message: z.string().trim().min(1).max(500),
  missingItems: z.array(z.string().trim().min(1).max(200)).max(10),
});

/** null 明确表示保持原值，避免 optional 字段在不同模型的 JSON Schema 中产生歧义。 */
export const templatePatchSchema = z.object({
  name: z.string().trim().min(1).max(TEMPLATE_FIELD_LIMITS.name).nullable(),
  description: z.string().max(TEMPLATE_FIELD_LIMITS.description).nullable(),
  variables: z.array(variableSchema).nullable(),
  explainStructure: z.string().max(TEMPLATE_FIELD_LIMITS.explainStructure).nullable(),
  consistencyRules: z.string().max(TEMPLATE_FIELD_LIMITS.consistencyRules).nullable(),
  constraintRules: z.string().max(TEMPLATE_FIELD_LIMITS.constraintRules).nullable(),
  exceptionBoundaryRules: z.string().max(
    TEMPLATE_FIELD_LIMITS.exceptionBoundaryRules,
  ).nullable(),
  verificationRules: z.string().max(TEMPLATE_FIELD_LIMITS.verificationRules).nullable(),
});

type TemplatePatch = z.infer<typeof templatePatchSchema>;

/**
 * LLM 的 Markdown 统一使用 LF，并让每个非空字段以恰好一个 LF 结束。
 * 空白内容视为清空字段；不截断超限内容，交由最终校验明确拒绝写库。
 */
export const normalizeMarkdownText = (value: string): string => {
  const normalized = value.replace(/\r\n?/g, "\n");
  if (!normalized.trim()) return "";
  return `${normalized.replace(/[\t \n]+$/g, "")}\n`;
};

const normalizeVariables = (variables: TemplateAgentContent["variables"]) =>
  variables.map((variable) => ({
    ...variable,
    value: normalizeMarkdownText(variable.value),
  }));

/** 完整生成只格式化六个 Markdown 内容字段，名称和描述保持模型原值。 */
export const normalizeTemplateMarkdown = (
  content: TemplateAgentContent,
): TemplateAgentContent => ({
  ...content,
  variables: normalizeVariables(content.variables),
  explainStructure: normalizeMarkdownText(content.explainStructure),
  consistencyRules: normalizeMarkdownText(content.consistencyRules),
  constraintRules: normalizeMarkdownText(content.constraintRules),
  exceptionBoundaryRules: normalizeMarkdownText(content.exceptionBoundaryRules),
  verificationRules: normalizeMarkdownText(content.verificationRules),
});

/** 局部调整只规范化非 null 补丁，确保未涉及字段保持数据库原文。 */
export const normalizeTemplateMarkdownPatch = (
  patch: TemplatePatch,
): TemplatePatch => ({
  ...patch,
  variables: patch.variables === null ? null : normalizeVariables(patch.variables),
  explainStructure: patch.explainStructure === null
    ? null
    : normalizeMarkdownText(patch.explainStructure),
  consistencyRules: patch.consistencyRules === null
    ? null
    : normalizeMarkdownText(patch.consistencyRules),
  constraintRules: patch.constraintRules === null
    ? null
    : normalizeMarkdownText(patch.constraintRules),
  exceptionBoundaryRules: patch.exceptionBoundaryRules === null
    ? null
    : normalizeMarkdownText(patch.exceptionBoundaryRules),
  verificationRules: patch.verificationRules === null
    ? null
    : normalizeMarkdownText(patch.verificationRules),
});

export const evaluationSchema = z.object({
  passed: z.boolean(),
  blockingIssues: z.array(z.string().trim().min(1).max(300)).max(12),
  fixInstructions: z.array(z.string().trim().min(1).max(300)).max(12),
});

export const semanticValidationSchema = z.object({
  valid: z.boolean(),
  issues: z
    .array(
      z.object({
        field: z.enum([
          "template",
          "name",
          "description",
          "variables",
          "explainStructure",
          "consistencyRules",
          "constraintRules",
          "exceptionBoundaryRules",
          "verificationRules",
        ]),
        reason: z.string().trim().min(1).max(300),
        suggestion: z.string().trim().min(1).max(300),
      }),
    )
    .max(30),
});

export const getTemplateContentState = (
  content: TemplateAgentContent,
): TemplateContentState => {
  const populatedCount = TEMPLATE_KEY_FIELDS.filter((field) => {
    const value = content[field];
    return Array.isArray(value) ? value.length > 0 : value.trim().length > 0;
  }).length;

  if (populatedCount === 0) return "empty";
  if (populatedCount === TEMPLATE_KEY_FIELDS.length) return "substantive";
  return "partial";
};

/** Zod 保证字段类型和长度；这里补充 JSON Schema 难以表达的变量唯一性。 */
export const validateTemplateContent = (
  value: unknown,
): { success: true; data: TemplateAgentContent } | {
  success: false;
  issues: TemplateValidationIssue[];
} => {
  const parsed = templateContentSchema.safeParse(value);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        field: (issue.path[0] as TemplateAgentField | undefined) ?? "template",
        reason: issue.message,
        suggestion: "请按模板字段的类型和长度要求修正该内容。",
      })),
    };
  }

  const keys = new Set<string>();
  const duplicate = parsed.data.variables.find((variable) => {
    if (keys.has(variable.key)) return true;
    keys.add(variable.key);
    return false;
  });

  if (duplicate) {
    return {
      success: false,
      issues: [{
        field: "variables",
        reason: `变量名 ${duplicate.key} 重复。`,
        suggestion: "合并重复变量或为它们使用唯一名称。",
      }],
    };
  }

  return { success: true, data: parsed.data };
};

export const getDeterministicValidationIssues = (
  content: TemplateAgentContent,
): TemplateValidationIssue[] => {
  const result = validateTemplateContent(content);
  const issues = result.success ? [] : [...result.issues];

  // variables 允许按标准使用 [] 表示该模板不需要运行时参数，不能据此判定校验失败。
  for (const field of TEMPLATE_REQUIRED_TEXT_FIELDS) {
    const value = content[field];
    const empty = Array.isArray(value) ? value.length === 0 : value.trim() === "";
    if (empty) {
      issues.push({
        field,
        reason: `${TEMPLATE_FIELD_LABELS[field]}为空。`,
        suggestion: `补充符合${TEMPLATE_FIELD_LABELS[field]}语义的内容。`,
      });
    }
  }

  if (!content.description.trim()) {
    issues.push({
      field: "description",
      reason: "用途描述为空。",
      suggestion: "补充模板适用范围、触发条件和使用边界。",
    });
  }

  return issues;
};
