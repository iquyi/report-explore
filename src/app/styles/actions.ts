"use server";

import { revalidatePath } from "next/cache";
import { getDatabase } from "@/lib/database";
import type {
  ActionResult,
  ChatStyleOption,
  StyleDetail,
  StyleListItem,
  StyleMutationInput,
  StyleStatus,
} from "./types";

const STYLE_MANAGE_PATH = "/styles/manage";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STYLE_LIMITS = {
  name: 50,
  description: 500,
  promptRules: 50_000,
} as const;

type StyleRow = {
  id: string;
  name: string;
  description: string;
  prompt_rules: string;
  status: number;
  is_default: boolean;
  created_at: string | Date;
  updated_at: string | Date;
};

type StyleListRow = Omit<StyleRow, "prompt_rules">;
type ChatStyleRow = Pick<
  StyleRow,
  "id" | "name" | "description" | "is_default"
>;
type IdRow = { id: string };
type StatusRow = { id: string; status: number };

const failure = <T>(error: string): ActionResult<T> => ({
  success: false,
  error,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validateId = (id: unknown): ActionResult<string> =>
  typeof id === "string" && UUID_PATTERN.test(id)
    ? { success: true, data: id }
    : failure("设计风格 ID 格式不正确。");

/** 浏览器表单不能作为信任边界，服务端再次完成必填、裁剪与长度校验。 */
const normalizeStyleInput = (
  input: unknown,
): ActionResult<StyleMutationInput> => {
  if (!isRecord(input)) return failure("设计风格数据格式不正确。");

  const name = typeof input.name === "string" ? input.name.trim() : "";
  const description =
    typeof input.description === "string" ? input.description.trim() : "";
  const promptRules =
    typeof input.promptRules === "string" ? input.promptRules.trim() : "";

  if (!name) return failure("风格名称不能为空。");
  if (!description) return failure("用途描述不能为空。");
  if (!promptRules) return failure("Prompt Rules 不能为空。");
  if (name.length > STYLE_LIMITS.name) {
    return failure(`风格名称不能超过 ${STYLE_LIMITS.name} 个字符。`);
  }
  if (description.length > STYLE_LIMITS.description) {
    return failure(`用途描述不能超过 ${STYLE_LIMITS.description} 个字符。`);
  }
  if (promptRules.length > STYLE_LIMITS.promptRules) {
    return failure(`Prompt Rules 不能超过 ${STYLE_LIMITS.promptRules} 个字符。`);
  }

  return { success: true, data: { name, description, promptRules } };
};

const toListItem = (row: StyleListRow): StyleListItem => ({
  id: row.id,
  name: row.name,
  description: row.description,
  status: Number(row.status) as StyleStatus,
  isDefault: Boolean(row.is_default),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const toDetail = (row: StyleRow): StyleDetail => ({
  ...toListItem(row),
  promptRules: row.prompt_rules,
});

const toChatStyleOption = (row: ChatStyleRow): ChatStyleOption => ({
  id: row.id,
  name: row.name,
  description: row.description,
  isDefault: Boolean(row.is_default),
});

const refreshStyleConsumers = () => {
  revalidatePath(STYLE_MANAGE_PATH);
  revalidatePath("/chat");
};

/** 管理列表不返回可能很长的 Prompt 正文，避免首屏传输无用数据。 */
export async function queryStyles(): Promise<ActionResult<StyleListItem[]>> {
  try {
    const sql = getDatabase();
    const rows = (await sql`
      SELECT id, name, description, status, is_default, created_at, updated_at
      FROM styles
      ORDER BY is_default DESC, updated_at DESC, id DESC
    `) as StyleListRow[];

    return { success: true, data: rows.map(toListItem) };
  } catch (error) {
    console.error("Failed to query styles.", error);
    return failure("设计风格加载失败，请稍后重试。");
  }
}

/** 聊天页仅返回可用于报告生成的启用风格，并严格裁剪掉 Prompt Rules。 */
export async function queryAvailableStyles(): Promise<
  ActionResult<ChatStyleOption[]>
> {
  try {
    const sql = getDatabase();
    const rows = (await sql`
      SELECT id, name, description, is_default
      FROM styles
      WHERE status = 1
      ORDER BY is_default DESC, updated_at DESC, id DESC
    `) as ChatStyleRow[];

    return { success: true, data: rows.map(toChatStyleOption) };
  } catch (error) {
    console.error("Failed to query available styles.", error);
    return failure("设计风格加载失败，请稍后重试。");
  }
}

/** 编辑抽屉打开时才读取完整 Prompt。 */
export async function queryStyle(
  id: string,
): Promise<ActionResult<StyleDetail | null>> {
  const idValidation = validateId(id);
  if (!idValidation.success) return { success: true, data: null };

  try {
    const sql = getDatabase();
    const rows = (await sql`
      SELECT id, name, description, prompt_rules, status, is_default, created_at, updated_at
      FROM styles
      WHERE id = ${idValidation.data}
      LIMIT 1
    `) as StyleRow[];
    return { success: true, data: rows[0] ? toDetail(rows[0]) : null };
  } catch (error) {
    console.error("Failed to query style.", error);
    return failure("设计风格详情加载失败，请稍后重试。");
  }
}

/** 新建风格固定为停用且非默认，必须由管理员在列表中显式启用。 */
export async function createStyle(
  input: StyleMutationInput,
): Promise<ActionResult<StyleListItem>> {
  const validation = normalizeStyleInput(input);
  if (!validation.success) return validation;

  try {
    const sql = getDatabase();
    const value = validation.data;
    const rows = (await sql`
      INSERT INTO styles (name, description, prompt_rules, status, is_default)
      VALUES (${value.name}, ${value.description}, ${value.promptRules}, 0, FALSE)
      RETURNING id, name, description, status, is_default, created_at, updated_at
    `) as StyleListRow[];

    refreshStyleConsumers();
    return { success: true, data: toListItem(rows[0]) };
  } catch (error) {
    console.error("Failed to create style.", error);
    return failure("设计风格创建失败，请检查名称是否重复后重试。");
  }
}

export async function updateStyle(
  id: string,
  input: StyleMutationInput,
): Promise<ActionResult<StyleListItem>> {
  const idValidation = validateId(id);
  if (!idValidation.success) return idValidation;
  const inputValidation = normalizeStyleInput(input);
  if (!inputValidation.success) return inputValidation;

  try {
    const sql = getDatabase();
    const value = inputValidation.data;
    const rows = (await sql`
      UPDATE styles
      SET
        name = ${value.name},
        description = ${value.description},
        prompt_rules = ${value.promptRules}
      WHERE id = ${idValidation.data}
      RETURNING id, name, description, status, is_default, created_at, updated_at
    `) as StyleListRow[];

    if (rows.length === 0) return failure("设计风格不存在或已被删除。");
    refreshStyleConsumers();
    return { success: true, data: toListItem(rows[0]) };
  } catch (error) {
    console.error("Failed to update style.", error);
    return failure("设计风格保存失败，请检查名称是否重复后重试。");
  }
}

/** 默认风格是报告生成兜底项，不能通过状态开关停用。 */
export async function setStyleStatus(
  id: string,
  status: StyleStatus,
): Promise<ActionResult<{ id: string; status: StyleStatus }>> {
  const idValidation = validateId(id);
  if (!idValidation.success) return idValidation;
  if (status !== 0 && status !== 1) return failure("status 只能是 0 或 1。");

  try {
    const sql = getDatabase();
    const rows = (await sql`
      UPDATE styles
      SET status = ${status}
      WHERE id = ${idValidation.data}
        AND (${status} = 1 OR is_default = FALSE)
      RETURNING id, status
    `) as StatusRow[];

    if (rows.length === 0) {
      return failure(
        status === 0
          ? "默认风格不能停用，请先将其他风格设为默认。"
          : "设计风格不存在或已被删除。",
      );
    }
    refreshStyleConsumers();
    return {
      success: true,
      data: { id: rows[0].id, status: Number(rows[0].status) as StyleStatus },
    };
  } catch (error) {
    console.error("Failed to update style status.", error);
    return failure("设计风格状态更新失败，请稍后重试。");
  }
}

/**
 * 先确认目标存在，再在同一数据库事务内清除旧默认并设置新默认。
 * 目标会被自动启用，旧默认保持启用状态。
 */
export async function setDefaultStyle(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const idValidation = validateId(id);
  if (!idValidation.success) return idValidation;

  try {
    const sql = getDatabase();
    const existing = (await sql`
      SELECT id
      FROM styles
      WHERE id = ${idValidation.data}
      LIMIT 1
    `) as IdRow[];
    if (existing.length === 0) return failure("设计风格不存在或已被删除。");

    await sql.transaction((tx) => [
      // 锁定目标；若它在预检查后被并发删除，除零错误会回滚整个事务并保留旧默认项。
      tx`
        SELECT 1 / COUNT(*)::INTEGER AS target_guard
        FROM (
          SELECT id FROM styles WHERE id = ${idValidation.data} FOR UPDATE
        ) AS target
      `,
      tx`UPDATE styles SET is_default = FALSE WHERE is_default = TRUE`,
      tx`
        UPDATE styles
        SET is_default = TRUE, status = 1
        WHERE id = ${idValidation.data}
      `,
    ]);

    refreshStyleConsumers();
    return { success: true, data: { id: idValidation.data } };
  } catch (error) {
    console.error("Failed to set default style.", error);
    return failure("默认风格设置失败，请稍后重试。");
  }
}

/** 删除由服务端再次限制为非默认记录，不能只依赖客户端禁用按钮。 */
export async function deleteStyle(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const idValidation = validateId(id);
  if (!idValidation.success) return idValidation;

  try {
    const sql = getDatabase();
    const rows = (await sql`
      DELETE FROM styles
      WHERE id = ${idValidation.data} AND is_default = FALSE
      RETURNING id
    `) as IdRow[];

    if (rows.length === 0) {
      return failure("默认风格不能删除，请先将其他风格设为默认。");
    }
    refreshStyleConsumers();
    return { success: true, data: { id: rows[0].id } };
  } catch (error) {
    console.error("Failed to delete style.", error);
    return failure("设计风格删除失败，请稍后重试。");
  }
}
