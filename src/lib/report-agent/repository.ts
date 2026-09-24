import "server-only";

import { getDatabase } from "@/lib/database";
import type { ReportTemplate } from "./types";

type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  variables: unknown;
  explain_structure: string | null;
  consistency_rules: string | null;
  constraint_rules: string | null;
  exception_boundary_rules: string | null;
  verification_rules: string | null;
};

const normalizeVariables = (value: unknown) =>
  Array.isArray(value)
    ? value.filter(
        (item): item is { key: string; value: string } =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as { key?: unknown }).key === "string" &&
          typeof (item as { value?: unknown }).value === "string",
      )
    : [];

/** 只加载已发布且启用的模板；blueprint 字段有意不查询、不进入报告生成上下文。 */
export async function queryPublishedReportTemplates(): Promise<ReportTemplate[]> {
  const sql = getDatabase();
  const rows = (await sql`
    SELECT
      id, name, description, variables, explain_structure,
      consistency_rules, constraint_rules, exception_boundary_rules,
      verification_rules
    FROM templates
    WHERE type = 'report' AND is_draft = 0 AND status = 1
    ORDER BY updated_at DESC, id DESC
  `) as TemplateRow[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    variables: normalizeVariables(row.variables),
    explainStructure: row.explain_structure ?? "",
    consistencyRules: row.consistency_rules ?? "",
    constraintRules: row.constraint_rules ?? "",
    exceptionBoundaryRules: row.exception_boundary_rules ?? "",
    verificationRules: row.verification_rules ?? "",
  }));
}

