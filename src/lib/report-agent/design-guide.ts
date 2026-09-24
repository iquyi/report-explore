import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

/** 每次报告任务只读取一次；空文件是有效配置，缺失或不可读则属于部署配置错误。 */
export async function loadDesignGuide() {
  const filePath = path.join(process.cwd(), "design-skill.md");
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    console.error("Failed to read design-skill.md.", error);
    throw new Error("服务端缺少或无法读取 design-skill.md，请检查部署文件追踪配置。");
  }
}

