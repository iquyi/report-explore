/** 模板业务字段的唯一中文名称映射，供校验、摘要和用户消息共同复用。 */
export const TEMPLATE_FIELD_LABELS = {
  name: "模板名称",
  description: "用途描述",
  variables: "模板变量",
  explainStructure: "报告结构",
  consistencyRules: "一致性规则",
  constraintRules: "核心约束",
  exceptionBoundaryRules: "异常边界处理",
  verificationRules: "交付校验规则",
} as const;
