"use server";

import { revalidatePath } from "next/cache";
import { getDatabase } from "@/lib/database";
import type {
  ActionResult,
  TemplateListItem,
  TemplateMutationInput,
  TemplateStatus,
  TemplateType,
} from "./types";

const TEMPLATE_MANAGE_PATH = "/template-manage";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BLUEPRINT_PATTERN = /\.(json|html)(\?.*)?$/i;
const TEMPLATE_TYPES = new Set<TemplateType>(["report", "design"]);

type TemplateListRow = {
  id: string;
  name: string;
  description: string;
  type: TemplateType;
  status: number;
  created_at: string | Date;
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

/** 可选规则使用 NULL 表示未配置；空字符串也统一归一化为 NULL。 */
const normalizeOptionalRule = (
  value: unknown,
  label: string,
): ActionResult<string | null> => {
  if (value === undefined || value === null || value === "") {
    return { success: true, data: null };
  }

  if (typeof value !== "string") {
    return failure(`${label}必须是字符串。`);
  }

  if (value.length > 1000) {
    return failure(`${label}不能超过 1000 个字符。`);
  }

  return { success: true, data: value };
};

/** 在进入 SQL 前镜像表结构约束，向调用方返回稳定且可读的错误。 */
const validateTemplateInput = (
  value: unknown,
): ActionResult<NormalizedTemplateInput> => {
  if (!isRecord(value)) return failure("模板数据格式不正确。");

  if (!isRequiredString(value.name)) return failure("name 不能为空。");
  if (value.name.length > 50) return failure("name 不能超过 50 个字符。");

  if (!isRequiredString(value.description)) {
    return failure("description 不能为空。");
  }
  if (value.description.length > 500) {
    return failure("description 不能超过 500 个字符。");
  }

  if (!isRequiredString(value.variables)) {
    return failure("variables 不能为空。");
  }

  if (!isRequiredString(value.explainStructure)) {
    return failure("explainStructure 不能为空。");
  }
  if (value.explainStructure.length > 10000) {
    return failure("explainStructure 不能超过 10000 个字符。");
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
  );
  if (!consistencyRules.success) return consistencyRules;

  const constraintRules = normalizeOptionalRule(
    value.constraintRules,
    "constraintRules",
  );
  if (!constraintRules.success) return constraintRules;

  const exceptionBoundaryRules = normalizeOptionalRule(
    value.exceptionBoundaryRules,
    "exceptionBoundaryRules",
  );
  if (!exceptionBoundaryRules.success) return exceptionBoundaryRules;

  const verificationRules = normalizeOptionalRule(
    value.verificationRules,
    "verificationRules",
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
      variables: value.variables,
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
      SELECT id, name, description, type, status, created_at
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
        createdAt: new Date(row.created_at).toISOString(),
      })),
    };
  } catch (error) {
    console.error("Failed to query templates.", error);
    return failure("模板数据加载失败，请稍后重试。");
  }
}

/** 创建 Action 已完整实现，当前页面暂不提供调用入口。 */
export async function createTemplate(
  input: TemplateMutationInput,
): Promise<ActionResult<{ id: string }>> {
  const validation = validateTemplateInput(input);
  if (!validation.success) return validation;

  try {
    const sql = getDatabase();
    const value = validation.data;
    const rows = (await sql`
      INSERT INTO templates (
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
        group_id
      )
      VALUES (
        ${value.name},
        ${value.description},
        ${value.variables},
        ${value.explainStructure},
        ${value.consistencyRules},
        ${value.constraintRules},
        ${value.exceptionBoundaryRules},
        ${value.verificationRules},
        ${value.type},
        ${value.status},
        ${value.blueprint},
        ${value.cover},
        ${value.groupId}
      )
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
        variables = ${value.variables},
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
