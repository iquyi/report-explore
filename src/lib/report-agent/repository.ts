import "server-only";

import { getDatabase } from "@/lib/database";
import type { DesignStyle, ReportTemplate } from "./types";

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

type StyleRow = {
  id: string;
  name: string;
  description: string;
  prompt_rules: string;
  is_default: boolean;
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

/**
 * 只加载启用风格并验证唯一默认项。管理页虽然保护默认记录，运行时仍独立校验，
 * 防止人工 SQL 修改造成无兜底风格的隐式降级。
 */
export async function queryPublishedDesignStyles(): Promise<DesignStyle[]> {
  const sql = getDatabase();
  const rows = (await sql`
    SELECT id, name, description, prompt_rules, is_default
    FROM styles
    WHERE status = 1
    ORDER BY is_default DESC, updated_at DESC, id DESC
  `) as StyleRow[];

  const defaultCount = rows.filter((row) => row.is_default).length;
  if (rows.length === 0 || defaultCount !== 1) {
    throw new Error("设计风格配置无效：必须存在且只能存在一个已启用的默认风格。");
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    promptRules: row.prompt_rules,
    isDefault: row.is_default,
  }));
}
