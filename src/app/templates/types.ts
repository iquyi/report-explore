export type TemplateType = "report" | "design";
export type TemplateStatus = 0 | 1;

/** 表格只接收展示需要的字段，避免把大段模板正文发送到浏览器。 */
export type TemplateListItem = {
  id: string;
  name: string;
  description: string;
  type: TemplateType;
  status: TemplateStatus;
  createdAt: string;
};

/** 创建和修改共用完整的可编辑字段，数据库自动维护主键和时间字段。 */
export type TemplateMutationInput = {
  name: string;
  description: string;
  variables: string;
  explainStructure: string;
  consistencyRules?: string | null;
  constraintRules?: string | null;
  exceptionBoundaryRules?: string | null;
  verificationRules?: string | null;
  type: TemplateType;
  status: TemplateStatus;
  blueprint: string;
  cover?: string;
  groupId?: string | null;
};

/** 所有 Action 使用同一种可判别结果，客户端无需依赖异常文本。 */
export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };
