import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

const GENERATION_GUIDE_FILE_NAME = "generate-report-v2.md";
const ADJUSTMENT_GUIDE_FILE_NAME = "adjust-report-v1.md";
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
 * 两类工作流只会传入代码内固定的文件名，用户输入永远不参与路径解析。
 * 读取后统一换行并检查公共八字段章节，避免空文件或残缺文件静默生效。
 */
async function loadReportGuide({
  fileName,
  purpose,
  requiredSections = [],
}: {
  fileName: string;
  purpose: string;
  requiredSections?: string[];
}): Promise<string> {
  const guidePath = path.join(process.cwd(), fileName);
  const normalized = (await readFile(guidePath, "utf8"))
    .replace(/\r\n?/g, "\n")
    .trim();

  if (!normalized) {
    throw new Error(`${fileName} 为空，无法执行${purpose}。`);
  }

  const missingHeadings = REQUIRED_FIELD_HEADINGS.filter(
    (field) => !normalized.includes(`### \`${field}\``),
  );
  if (missingHeadings.length > 0) {
    throw new Error(
      `${fileName} 缺少字段章节：${missingHeadings.join("、")}。`,
    );
  }

  const missingSections = requiredSections.filter(
    (heading) => !normalized.includes(heading),
  );
  if (missingSections.length > 0) {
    throw new Error(
      `${fileName} 缺少必要章节：${missingSections.join("、")}。`,
    );
  }

  return `${normalized}\n`;
}

/** 完整生成的初稿、评价和优化共享同一次读取结果。 */
export const loadGenerateReportGuide = () =>
  loadReportGuide({
    fileName: GENERATION_GUIDE_FILE_NAME,
    purpose: "完整模板生成",
  });

/** 局部调整的补丁、评价和优化共享同一次读取结果，并额外校验补丁协议。 */
export const loadAdjustReportGuide = () =>
  loadReportGuide({
    fileName: ADJUSTMENT_GUIDE_FILE_NAME,
    purpose: "局部模板调整",
    requiredSections: ["## 补丁输出协议"],
  });
