import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEMO_REPORT_PROMPTS,
  type DemoReportPrompt,
} from "../report-demo";

type MockReportFormat = "html" | "markdown";

type MockReportSourceDefinition = {
  fileName: string;
  format: MockReportFormat;
};

export type MockReportSource = MockReportSourceDefinition & {
  prompt: DemoReportPrompt;
  content: string;
};

export { DEMO_REPORT_PROMPTS as MOCK_REPORT_PROMPTS };

/**
 * 固定演示需求只允许命中明确登记的本地文件，禁止由用户输入拼接路径。
 * 这样既保证演示结果稳定，也避免路径穿越和误读其他项目文件。
 */
const MOCK_REPORT_SOURCE_BY_PROMPT: Record<
  DemoReportPrompt,
  MockReportSourceDefinition
> = {
  生成定兴县食品加工产业招商评估报告: {
    fileName: "定兴县食品加工产业招商评估报告.html",
    format: "html",
  },
  生成北京市人工智能产业诊断报告: {
    fileName: "北京市人工智能产业诊断报告.md",
    format: "markdown",
  },
  生成月之暗面企业画像报告: {
    fileName: "月之暗面企业画像报告.md",
    format: "markdown",
  },
};

/** 仅裁剪首尾空白；除三条固定演示指令外，不扩大 mock 数据的匹配范围。 */
export function getMockReportSourceDefinition(request: string) {
  const normalizedRequest = request.trim() as DemoReportPrompt;
  const source = MOCK_REPORT_SOURCE_BY_PROMPT[normalizedRequest];
  return source
    ? { prompt: normalizedRequest, ...source }
    : null;
}

/** 研究阶段只返回中性进度，避免通过 SSE 向用户暴露实际数据渠道。 */
export function getResearchStageLabel(request: string) {
  // 保留参数以兼容现有调用签名，但文案不得再随资料路由变化。
  void request;
  return "正在研究报告所需资料…";
}

/** 将解码校验拆成纯函数，既便于测试，也确保所有 mock 文件使用同一规则。 */
export function decodeMockReportContent(bytes: Uint8Array, fileName: string) {
  const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (content.includes("\uFFFD")) {
    throw new Error(`演示资料 ${fileName} 包含无效替换字符。`);
  }
  return content;
}

/**
 * 使用 fatal UTF-8 解码并额外拒绝已写入文件的替换字符，避免乱码被静默送入模型。
 */
export async function loadMockReportSource(
  request: string,
): Promise<MockReportSource | null> {
  const source = getMockReportSourceDefinition(request);
  if (!source) return null;

  const filePath = path.join(
    process.cwd(),
    "src",
    "lib",
    "data-source-mock",
    source.fileName,
  );
  const content = decodeMockReportContent(
    await readFile(filePath),
    source.fileName,
  );

  return { ...source, content };
}
