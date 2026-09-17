import "server-only";

import { revalidatePath } from "next/cache";
import { getDatabase } from "@/lib/database";
import { variableSchema } from "./schema";
import type {
  TemplateAgentContent,
  TemplateAgentField,
} from "./types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type TemplateAgentRow = {
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
};

type UpdatedRow = { id: string; revision: string | number };

export type TemplateAgentSnapshot = {
  id: string;
  revision: number;
  content: TemplateAgentContent;
};

export const isValidTemplateId = (id: string): boolean => UUID_PATTERN.test(id);

const parseVariables = (value: unknown) => {
  const result = variableSchema.array().safeParse(value);
  if (!result.success) {
    throw new Error("数据库中的 variables 不符合模板变量结构。");
  }
  return result.data;
};

/** 每一轮 Agent 请求都通过此查询获取唯一可信模板快照。 */
export async function getTemplateAgentSnapshot(
  id: string,
): Promise<TemplateAgentSnapshot | null> {
  if (!isValidTemplateId(id)) return null;

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
      verification_rules
    FROM templates
    WHERE id = ${id}
    LIMIT 1
  `) as TemplateAgentRow[];

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    revision: Number(row.revision),
    content: {
      name: row.name,
      description: row.description ?? "",
      variables: parseVariables(row.variables),
      explainStructure: row.explain_structure ?? "",
      consistencyRules: row.consistency_rules ?? "",
      constraintRules: row.constraint_rules ?? "",
      exceptionBoundaryRules: row.exception_boundary_rules ?? "",
      verificationRules: row.verification_rules ?? "",
    },
  };
}

const comparableValue = (value: TemplateAgentContent[TemplateAgentField]) =>
  typeof value === "string" ? value : JSON.stringify(value);

export const getChangedTemplateFields = (
  before: TemplateAgentContent,
  after: TemplateAgentContent,
): TemplateAgentField[] =>
  (Object.keys(before) as TemplateAgentField[]).filter(
    (field) => comparableValue(before[field]) !== comparableValue(after[field]),
  );

/**
 * 一次 SQL 更新八个目标字段，并用 revision 防止覆盖 Agent 执行期间的新修改。
 * 数据库触发器负责递增 revision 和写入 template_versions 快照。
 */
export async function updateTemplateAgentSnapshot(
  id: string,
  expectedRevision: number,
  content: TemplateAgentContent,
): Promise<{ status: "updated"; revision: number } | { status: "conflict" }> {
  const sql = getDatabase();
  const rows = (await sql`
    UPDATE templates
    SET
      name = ${content.name},
      description = ${content.description || null},
      variables = ${JSON.stringify(content.variables)}::jsonb,
      explain_structure = ${content.explainStructure || null},
      consistency_rules = ${content.consistencyRules || null},
      constraint_rules = ${content.constraintRules || null},
      exception_boundary_rules = ${content.exceptionBoundaryRules || null},
      verification_rules = ${content.verificationRules || null}
    WHERE id = ${id}
      AND revision = ${expectedRevision}
    RETURNING id, revision
  `) as unknown as UpdatedRow[];

  if (rows.length === 0) return { status: "conflict" };

  revalidatePath("/templates/manage");
  revalidatePath(`/templates/generate/${id}`);
  return { status: "updated", revision: Number(rows[0].revision) };
}

