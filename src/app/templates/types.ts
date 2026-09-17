export type TemplateType = "report" | "design";
export type TemplateStatus = 0 | 1;
export type TemplateDraftStatus = 0 | 1;

/** JSONB 变量只保存业务字段，界面使用的临时 ID 不进入数据库。 */
export type TemplateVariable = {
  key: string;
  value: string;
};

export type TemplateTextEditableField =
  | "name"
  | "description"
  | "explainStructure"
  | "consistencyRules"
  | "constraintRules"
  | "exceptionBoundaryRules"
  | "verificationRules";

export type TemplateEditableField = TemplateTextEditableField | "variables";

/** 字段和值组成判别联合，避免把字符串误传给 JSONB 变量字段。 */
export type TemplateFieldUpdate =
  | { field: TemplateTextEditableField; value: string }
  | { field: "variables"; value: TemplateVariable[] };

/** 表格只接收展示需要的字段，避免把大段模板正文发送到浏览器。 */
export type TemplateListItem = {
  id: string;
  name: string;
  description: string | null;
  type: TemplateType;
  status: TemplateStatus;
  isDraft: TemplateDraftStatus;
  createdAt: string;
};

/** 列表页仅收集名称，其余草稿字段由数据库默认值和服务端固定值补齐。 */
export type CreateTemplateInput = {
  name: string;
};

/** 动态编辑页使用完整详情；数据库中的可选字段保持 null 语义。 */
export type TemplateDetail = {
  id: string;
  revision: number;
  name: string;
  description: string | null;
  variables: TemplateVariable[];
  explainStructure: string | null;
  consistencyRules: string | null;
  constraintRules: string | null;
  exceptionBoundaryRules: string | null;
  verificationRules: string | null;
  type: TemplateType;
  status: TemplateStatus;
  blueprint: string | null;
  cover: string | null;
  groupId: string | null;
  isDraft: TemplateDraftStatus;
  createdAt: string;
  updatedAt: string;
};

/** 创建和修改共用完整的可编辑字段，数据库自动维护主键和时间字段。 */
export type TemplateMutationInput = {
  name: string;
  description: string;
  variables: TemplateVariable[];
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
