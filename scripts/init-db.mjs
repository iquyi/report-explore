import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const connectionString =
  process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

// 初始化属于数据库管理操作，缺少连接信息时立即终止，避免连接到未知目标。
if (!connectionString) {
  throw new Error("Missing DATABASE_URL_UNPOOLED or DATABASE_URL.");
}

const sql = neon(connectionString);
const schemaSources = await Promise.all(
  ["database/init_templates.sql", "database/init_styles.sql"].map((relativePath) =>
    readFile(path.join(projectRoot, relativePath), "utf8"),
  ),
);
const defaultStylePromptRules = await readFile(
  path.join(projectRoot, "design-skill.md"),
  "utf8",
);

// 只按显式标记拆分顶层语句，防止函数体内的分号破坏 PL/pgSQL 定义。
const statementDelimiter = "-- statement-breakpoint";
const transactionControlStatements = new Set(["BEGIN;", "COMMIT;"]);
const statements = schemaSources
  .flatMap((source) => source.split(statementDelimiter))
  .map((statement) => statement.trim())
  .filter(Boolean)
  .filter((statement) => !transactionControlStatements.has(statement));

if (statements.length === 0) {
  throw new Error("No database initialization statements were found.");
}

// SQL 文件受项目版本控制，可以作为可信 SQL 在一次原子事务中执行。
await sql.transaction((tx) => [
  ...statements.map((statement) => tx`${tx.unsafe(statement)}`),
  // 固定主键与 DO NOTHING 保证初始化只导入一次，不覆盖后续通过页面或 SQL 完成的修改。
  tx`
    INSERT INTO styles (
      id,
      name,
      description,
      prompt_rules,
      status,
      is_default
    )
    VALUES (
      '10000000-0000-4000-8000-000000000001',
      '蓝色科技编辑风格',
      '适用于 PC 浏览器报告的克制、可信、现代蓝色科技编辑设计。',
      ${defaultStylePromptRules},
      1,
      TRUE
    )
    ON CONFLICT DO NOTHING
  `,
]);

// 输出最终数据，方便执行者立即确认表结构初始化和 mock 数据写入结果。
const rows = await sql`
  SELECT id, name, type, status, blueprint, cover, group_id, created_at, updated_at
  FROM templates
  ORDER BY created_at, id
`;

console.log("templates table initialized.");
console.table(rows);

const styleRows = await sql`
  SELECT id, name, status, is_default, created_at, updated_at
  FROM styles
  ORDER BY created_at, id
`;

console.log("styles table initialized.");
console.table(styleRows);
