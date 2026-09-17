import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

const GUIDE_FILE_NAME = "generate-report-v2.md";
const REQUIRED_FIELD_HEADINGS = [
  "name",
  "description",
  "variables",
  "explain_structure",
  "consistency_rules",
  "constraint_rules",
  "exception_boundary_rules",
  "verification_rules",
] as const;

/**
 * 每次完整生成只读取一次规范，并把同一字符串传给生成、评价和优化阶段。
 * 固定根目录路径禁止用户输入参与文件定位；章节检查则避免空文件或残缺文件静默生效。
 */
export async function loadGenerateReportGuide(): Promise<string> {
  const guidePath = path.join(process.cwd(), GUIDE_FILE_NAME);
  const normalized = (await readFile(guidePath, "utf8"))
    .replace(/\r\n?/g, "\n")
    .trim();

  if (!normalized) {
    throw new Error(`${GUIDE_FILE_NAME} 为空，无法执行完整模板生成。`);
  }

  const missingHeadings = REQUIRED_FIELD_HEADINGS.filter(
    (field) => !normalized.includes(`### \`${field}\``),
  );
  if (missingHeadings.length > 0) {
    throw new Error(
      `${GUIDE_FILE_NAME} 缺少字段章节：${missingHeadings.join("、")}。`,
    );
  }

  return `${normalized}\n`;
}
