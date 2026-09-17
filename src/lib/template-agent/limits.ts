/**
 * 模板字段长度在模型 Schema、服务端 Action 和编辑器中共享。
 * 数据库仍保留同值约束，作为绕过应用层写入时的最后防线。
 */
export const TEMPLATE_FIELD_LIMITS = {
  name: 50,
  description: 500,
  variableKey: 20,
  variableValue: 500,
  explainStructure: 10_000,
  consistencyRules: 10_000,
  constraintRules: 10_000,
  exceptionBoundaryRules: 10_000,
  verificationRules: 10_000,
} as const;

/** 仅包含单字段编辑接口允许更新的字符串字段，避免变量限制键进入字段白名单。 */
export const TEMPLATE_TEXT_FIELD_LIMITS = {
  name: TEMPLATE_FIELD_LIMITS.name,
  description: TEMPLATE_FIELD_LIMITS.description,
  explainStructure: TEMPLATE_FIELD_LIMITS.explainStructure,
  consistencyRules: TEMPLATE_FIELD_LIMITS.consistencyRules,
  constraintRules: TEMPLATE_FIELD_LIMITS.constraintRules,
  exceptionBoundaryRules: TEMPLATE_FIELD_LIMITS.exceptionBoundaryRules,
  verificationRules: TEMPLATE_FIELD_LIMITS.verificationRules,
} as const;
