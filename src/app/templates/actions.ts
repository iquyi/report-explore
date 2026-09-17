"use server";

import { revalidatePath } from "next/cache";
import { getDatabase } from "@/lib/database";
import {
  TEMPLATE_FIELD_LIMITS,
  TEMPLATE_TEXT_FIELD_LIMITS,
} from "@/lib/template-agent/limits";
import type {
  ActionResult,
  CreateTemplateInput,
  TemplateDetail,
  TemplateFieldUpdate,
  TemplateListItem,
  TemplateMutationInput,
  TemplateStatus,
  TemplateType,
  TemplateVariable,
} from "./types";

const TEMPLATE_MANAGE_PATH = "/templates/manage";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BLUEPRINT_PATTERN = /\.(json|html)(\?.*)?$/i;
const TEMPLATE_TYPES = new Set<TemplateType>(["report", "design"]);

type TemplateListRow = {
  id: string;
  name: string;
  description: string | null;
  type: TemplateType;
  status: number;
  is_draft: number;
  created_at: string | Date;
};

type TemplateDetailRow = {
  id: string;
  revision: string | number;
  name: string;
  description: string | null;
  variables: unknown;
  explain_structure: string | null;
  consistency_rules: string | null;
  constraint_rules: string | null;
  exception_boundary_rules: string | null;
  verification_rules: string | null;
  type: TemplateType;
  status: number;
  blueprint: string | null;
  cover: string | null;
  group_id: string | null;
  is_draft: number;
  created_at: string | Date;
  updated_at: string | Date;
};

type IdRow = { id: string };
type StatusRow = { id: string; status: number };

type NormalizedTemplateInput = Required<
  Omit<
    TemplateMutationInput,
    | "consistencyRules"
    | "constraintRules"
    | "exceptionBoundaryRules"
    | "verificationRules"
    | "cover"
    | "groupId"
  >
> & {
  consistencyRules: string | null;
  constraintRules: string | null;
  exceptionBoundaryRules: string | null;
  verificationRules: string | null;
  cover: string;
  groupId: string | null;
};

const failure = <T>(error: string): ActionResult<T> => ({
  success: false,
  error,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRequiredString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/** JSONB 变量在服务端做完整结构校验，不能只依赖数据库的数组约束。 */
const normalizeTemplateVariables = (
  value: unknown,
): ActionResult<TemplateVariable[]> => {
  if (!Array.isArray(value)) return failure("variables 必须是数组。");

  const variables: TemplateVariable[] = [];
  const keys = new Set<string>();

  for (const item of value) {
    if (!isRecord(item) || !isRequiredString(item.key)) {
      return failure("每个变量都必须包含非空 key。");
    }
    if (!isRequiredString(item.value)) {
      return failure("每个变量都必须包含非空 value。");
    }

    const key = item.key.trim();
    if (key.length > TEMPLATE_FIELD_LIMITS.variableKey) {
      return failure(`变量名最多 ${TEMPLATE_FIELD_LIMITS.variableKey} 字符。`);
    }
    if (item.value.length > TEMPLATE_FIELD_LIMITS.variableValue) {
      return failure(`变量定义最多 ${TEMPLATE_FIELD_LIMITS.variableValue} 字符。`);
    }
    if (keys.has(key)) return failure("变量名不能重复。");

    keys.add(key);
    variables.push({ key, value: item.value });
  }

  return { success: true, data: variables };
};

/** 草稿创建入口只接收名称，服务端仍独立执行必填和长度校验。 */
const validateCreateTemplateInput = (
  value: unknown,
): ActionResult<CreateTemplateInput> => {
  if (!isRecord(value)) return failure("模板数据格式不正确。");
  if (!isRequiredString(value.name)) return failure("name 不能为空。");

  const name = value.name.trim();
  if (name.length > TEMPLATE_FIELD_LIMITS.name) {
    return failure(`name 不能超过 ${TEMPLATE_FIELD_LIMITS.name} 个字符。`);
  }

  return { success: true, data: { name } };
};

/** 可选规则使用 NULL 表示未配置；空字符串也统一归一化为 NULL。 */
const normalizeOptionalRule = (
  value: unknown,
  label: string,
  maxLength: number,
): ActionResult<string | null> => {
  if (value === undefined || value === null || value === "") {
    return { success: true, data: null };
  }

  if (typeof value !== "string") {
    return failure(`${label}必须是字符串。`);
  }

  if (value.length > maxLength) {
    return failure(`${label}不能超过 ${maxLength} 个字符。`);
  }

  return { success: true, data: value };
};

/** 在进入 SQL 前镜像表结构约束，向调用方返回稳定且可读的错误。 */
const validateTemplateInput = (
  value: unknown,
): ActionResult<NormalizedTemplateInput> => {
  if (!isRecord(value)) return failure("模板数据格式不正确。");

  if (!isRequiredString(value.name)) return failure("name 不能为空。");
  if (value.name.length > TEMPLATE_FIELD_LIMITS.name) {
    return failure(`name 不能超过 ${TEMPLATE_FIELD_LIMITS.name} 个字符。`);
  }

  if (!isRequiredString(value.description)) {
    return failure("description 不能为空。");
  }
  if (value.description.length > TEMPLATE_FIELD_LIMITS.description) {
    return failure(`description 不能超过 ${TEMPLATE_FIELD_LIMITS.description} 个字符。`);
  }

  const variables = normalizeTemplateVariables(value.variables);
  if (!variables.success) return variables;

  if (!isRequiredString(value.explainStructure)) {
    return failure("explainStructure 不能为空。");
  }
  if (value.explainStructure.length > TEMPLATE_FIELD_LIMITS.explainStructure) {
    return failure(
      `explainStructure 不能超过 ${TEMPLATE_FIELD_LIMITS.explainStructure} 个字符。`,
    );
  }

  if (
    typeof value.type !== "string" ||
    !TEMPLATE_TYPES.has(value.type as TemplateType)
  ) {
    return failure("type 只能是 report 或 design。");
  }

  if (value.status !== 0 && value.status !== 1) {
    return failure("status 只能是 0 或 1。");
  }

  if (!isRequiredString(value.blueprint)) {
    return failure("blueprint 不能为空。");
  }
  if (!BLUEPRINT_PATTERN.test(value.blueprint)) {
    return failure("blueprint 必须是 JSON 或 HTML 文件路径。");
  }

  const consistencyRules = normalizeOptionalRule(
    value.consistencyRules,
    "consistencyRules",
    TEMPLATE_FIELD_LIMITS.consistencyRules,
  );
  if (!consistencyRules.success) return consistencyRules;

  const constraintRules = normalizeOptionalRule(
    value.constraintRules,
    "constraintRules",
    TEMPLATE_FIELD_LIMITS.constraintRules,
  );
  if (!constraintRules.success) return constraintRules;

  const exceptionBoundaryRules = normalizeOptionalRule(
    value.exceptionBoundaryRules,
    "exceptionBoundaryRules",
    TEMPLATE_FIELD_LIMITS.exceptionBoundaryRules,
  );
  if (!exceptionBoundaryRules.success) return exceptionBoundaryRules;

  const verificationRules = normalizeOptionalRule(
    value.verificationRules,
    "verificationRules",
    TEMPLATE_FIELD_LIMITS.verificationRules,
  );
  if (!verificationRules.success) return verificationRules;

  if (value.cover !== undefined && typeof value.cover !== "string") {
    return failure("cover 必须是字符串。");
  }

  if (
    value.groupId !== undefined &&
    value.groupId !== null &&
    typeof value.groupId !== "string"
  ) {
    return failure("groupId 必须是字符串或 null。");
  }

  return {
    success: true,
    data: {
      name: value.name,
      description: value.description,
      variables: variables.data,
      explainStructure: value.explainStructure,
      consistencyRules: consistencyRules.data,
      constraintRules: constraintRules.data,
      exceptionBoundaryRules: exceptionBoundaryRules.data,
      verificationRules: verificationRules.data,
      type: value.type as TemplateType,
      status: value.status as TemplateStatus,
      blueprint: value.blueprint,
      cover: typeof value.cover === "string" ? value.cover : "",
      groupId:
        typeof value.groupId === "string" && value.groupId.length > 0
          ? value.groupId
          : null,
    },
  };
};

const validateId = (id: unknown): ActionResult<string> => {
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    return failure("模板 ID 格式不正确。");
  }

  return { success: true, data: id };
};

/** 查询仅返回表格需要的轻量字段，并提供稳定的同时间排序。 */
export async function queryTemplates(): Promise<
  ActionResult<TemplateListItem[]>
> {
  try {
    const sql = getDatabase();
    const rows = (await sql`
      SELECT id, name, description, type, status, is_draft, created_at
      FROM templates
      ORDER BY created_at DESC, id DESC
    `) as TemplateListRow[];

    return {
      success: true,
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        type: row.type,
        status: Number(row.status) as TemplateStatus,
        isDraft: Number(row.is_draft) as TemplateListItem["isDraft"],
        createdAt: new Date(row.created_at).toISOString(),
      })),
    };
  } catch (error) {
    console.error("Failed to query templates.", error);
    return failure("模板数据加载失败，请稍后重试。");
  }
}

/** 按模板 ID 返回编辑页所需的完整数据；无效或不存在的 ID 统一返回 null。 */
export async function queryTemplate(
  id: string,
): Promise<ActionResult<TemplateDetail | null>> {
  const idValidation = validateId(id);
  if (!idValidation.success) return { success: true, data: null };

  try {
    const sql = getDatabase();
    const rows = (await sql`
      SELECT
        id,
        revision,
        name,
        description,
        variables,
        explain_structure,
        consistency_rules,
        constraint_rules,
        exception_boundary_rules,
        verification_rules,
        type,
        status,
        blueprint,
        cover,
        group_id,
        is_draft,
        created_at,
        updated_at
      FROM templates
      WHERE id = ${idValidation.data}
      LIMIT 1
    `) as TemplateDetailRow[];

    const row = rows[0];
    if (!row) return { success: true, data: null };

    const variables = normalizeTemplateVariables(row.variables);
    if (!variables.success) throw new Error(variables.error);

    return {
      success: true,
      data: {
        id: row.id,
        revision: Number(row.revision),
        name: row.name,
        description: row.description,
        variables: variables.data,
        explainStructure: row.explain_structure,
        consistencyRules: row.consistency_rules,
        constraintRules: row.constraint_rules,
        exceptionBoundaryRules: row.exception_boundary_rules,
        verificationRules: row.verification_rules,
        type: row.type,
        status: Number(row.status) as TemplateStatus,
        blueprint: row.blueprint,
        cover: row.cover,
        groupId: row.group_id,
        isDraft: Number(row.is_draft) as TemplateDetail["isDraft"],
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      },
    };
  } catch (error) {
    console.error("Failed to query template.", error);
    return failure("模板详情加载失败，请稍后重试。");
  }
}

/** 可选文本使用 NULL 表示空值，名称则保持必填并在保存前去除首尾空格。 */
const normalizeTemplateFieldUpdate = (
  value: unknown,
): ActionResult<
  | { field: "variables"; value: TemplateVariable[] }
  | { field: Exclude<TemplateFieldUpdate["field"], "variables">; value: string | null }
> => {
  if (!isRecord(value) || typeof value.field !== "string") {
    return failure("模板字段数据格式不正确。");
  }

  if (value.field === "variables") {
    const variables = normalizeTemplateVariables(value.value);
    return variables.success
      ? { success: true, data: { field: "variables", value: variables.data } }
      : variables;
  }

  if (typeof value.value !== "string") return failure("模板字段必须是字符串。");

  const limits = TEMPLATE_TEXT_FIELD_LIMITS;

  if (!(value.field in limits)) return failure("不支持修改该模板字段。");

  const field = value.field as keyof typeof limits;
  const text = field === "name" ? value.value.trim() : value.value;
  if (field === "name" && !text) return failure("name 不能为空。");
  if (text.length > limits[field]) {
    return failure(`${field} 不能超过 ${limits[field]} 个字符。`);
  }

  return {
    success: true,
    data: { field, value: field === "name" || text !== "" ? text : null },
  };
};

/** 单字段自动保存只执行白名单内的静态 SQL，避免动态列名进入查询。 */
export async function updateTemplateField(
  id: string,
  update: TemplateFieldUpdate,
): Promise<ActionResult<{ id: string }>> {
  const idValidation = validateId(id);
  if (!idValidation.success) return idValidation;

  const updateValidation = normalizeTemplateFieldUpdate(update);
  if (!updateValidation.success) return updateValidation;

  try {
    const sql = getDatabase();
    const value = updateValidation.data;
    let rows: IdRow[];

    switch (value.field) {
      case "name":
        rows = (await sql`UPDATE templates SET name = ${value.value} WHERE id = ${idValidation.data} RETURNING id`) as unknown as IdRow[];
        break;
      case "description":
        rows = (await sql`UPDATE templates SET description = ${value.value} WHERE id = ${idValidation.data} RETURNING id`) as unknown as IdRow[];
        break;
      case "variables":
        rows = (await sql`UPDATE templates SET variables = ${JSON.stringify(value.value)}::jsonb WHERE id = ${idValidation.data} RETURNING id`) as unknown as IdRow[];
        break;
      case "explainStructure":
        rows = (await sql`UPDATE templates SET explain_structure = ${value.value} WHERE id = ${idValidation.data} RETURNING id`) as unknown as IdRow[];
        break;
      case "consistencyRules":
        rows = (await sql`UPDATE templates SET consistency_rules = ${value.value} WHERE id = ${idValidation.data} RETURNING id`) as unknown as IdRow[];
        break;
      case "constraintRules":
        rows = (await sql`UPDATE templates SET constraint_rules = ${value.value} WHERE id = ${idValidation.data} RETURNING id`) as unknown as IdRow[];
        break;
      case "exceptionBoundaryRules":
        rows = (await sql`UPDATE templates SET exception_boundary_rules = ${value.value} WHERE id = ${idValidation.data} RETURNING id`) as unknown as IdRow[];
        break;
      case "verificationRules":
        rows = (await sql`UPDATE templates SET verification_rules = ${value.value} WHERE id = ${idValidation.data} RETURNING id`) as unknown as IdRow[];
        break;
    }

    if (rows.length === 0) return failure("模板不存在或已被删除。");

    revalidatePath(TEMPLATE_MANAGE_PATH);
    revalidatePath(`/templates/generate/${idValidation.data}`);
    return { success: true, data: { id: String(rows[0].id) } };
  } catch (error) {
    console.error("Failed to update template field.", error);
    return failure("模板字段保存失败，请稍后重试。");
  }
}

/** 先创建最小草稿记录，完整内容由后续编辑流程逐步补充。 */
export async function createTemplate(
  input: CreateTemplateInput,
): Promise<ActionResult<{ id: string }>> {
  const validation = validateCreateTemplateInput(input);
  if (!validation.success) return validation;

  try {
    const sql = getDatabase();
    const value = validation.data;
    const rows = (await sql`
      INSERT INTO templates (name, type)
      VALUES (${value.name}, 'report')
      RETURNING id
    `) as unknown as IdRow[];

    revalidatePath(TEMPLATE_MANAGE_PATH);
    return { success: true, data: { id: String(rows[0].id) } };
  } catch (error) {
    console.error("Failed to create template.", error);
    return failure("模板创建失败，请稍后重试。");
  }
}

/** 修改 Action 覆盖全部可编辑字段，updated_at 由数据库触发器维护。 */
export async function updateTemplate(
  id: string,
  input: TemplateMutationInput,
): Promise<ActionResult<{ id: string }>> {
  const idValidation = validateId(id);
  if (!idValidation.success) return idValidation;

  const inputValidation = validateTemplateInput(input);
  if (!inputValidation.success) return inputValidation;

  try {
    const sql = getDatabase();
    const value = inputValidation.data;
    const rows = (await sql`
      UPDATE templates
      SET
        name = ${value.name},
        description = ${value.description},
        variables = ${JSON.stringify(value.variables)}::jsonb,
        explain_structure = ${value.explainStructure},
        consistency_rules = ${value.consistencyRules},
        constraint_rules = ${value.constraintRules},
        exception_boundary_rules = ${value.exceptionBoundaryRules},
        verification_rules = ${value.verificationRules},
        type = ${value.type},
        status = ${value.status},
        blueprint = ${value.blueprint},
        cover = ${value.cover},
        group_id = ${value.groupId}
      WHERE id = ${idValidation.data}
      RETURNING id
    `) as unknown as IdRow[];

    if (rows.length === 0) return failure("模板不存在或已被删除。");

    revalidatePath(TEMPLATE_MANAGE_PATH);
    return { success: true, data: { id: String(rows[0].id) } };
  } catch (error) {
    console.error("Failed to update template.", error);
    return failure("模板修改失败，请稍后重试。");
  }
}

/** 删除前由客户端二次确认；服务端仍独立校验 ID 和记录是否存在。 */
export async function deleteTemplate(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const idValidation = validateId(id);
  if (!idValidation.success) return idValidation;

  try {
    const sql = getDatabase();
    const rows = (await sql`
      DELETE FROM templates
      WHERE id = ${idValidation.data}
      RETURNING id
    `) as unknown as IdRow[];

    if (rows.length === 0) return failure("模板不存在或已被删除。");

    revalidatePath(TEMPLATE_MANAGE_PATH);
    return { success: true, data: { id: String(rows[0].id) } };
  } catch (error) {
    console.error("Failed to delete template.", error);
    return failure("模板删除失败，请稍后重试。");
  }
}

/** 状态更新只允许 0/1，避免将任意数字写入 SMALLINT 字段。 */
export async function setTemplateStatus(
  id: string,
  status: TemplateStatus,
): Promise<ActionResult<{ id: string; status: TemplateStatus }>> {
  const idValidation = validateId(id);
  if (!idValidation.success) return idValidation;
  if (status !== 0 && status !== 1) return failure("status 只能是 0 或 1。");

  try {
    const sql = getDatabase();
    const rows = (await sql`
      UPDATE templates
      SET status = ${status}
      WHERE id = ${idValidation.data}
      RETURNING id, status
    `) as unknown as StatusRow[];

    if (rows.length === 0) return failure("模板不存在或已被删除。");

    revalidatePath(TEMPLATE_MANAGE_PATH);
    return {
      success: true,
      data: {
        id: String(rows[0].id),
        status: Number(rows[0].status) as TemplateStatus,
      },
    };
  } catch (error) {
    console.error("Failed to update template status.", error);
    return failure("模板状态更新失败，请稍后重试。");
  }
}
