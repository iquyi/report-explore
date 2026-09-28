import {
  assertNoSourceDisclosure,
  sanitizeReportHtml,
} from "./html-safety";

export type ParsedReportMarkdown = {
  before: string;
  html: string;
  after: string;
};

/** 使用独立错误类型区分模型格式违规与其他生成故障，便于安全地触发唯一一次重试。 */
export class ReportMarkdownFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportMarkdownFormatError";
  }
}

type Fence = {
  start: number;
  contentStart: number;
  contentEnd: number;
  end: number;
  language: string;
};

/**
 * 按行扫描 fenced code block，避免宽松正则把未闭合围栏或多个代码块误判为一个报告。
 * 报告协议只允许三反引号围栏，且整个 Markdown 中只能出现一个代码块。
 */
const findFences = (markdown: string) => {
  const lines = markdown.matchAll(/^(```)([^\r\n]*)\r?$/gm);
  const fences: Fence[] = [];
  let opening: { start: number; contentStart: number; language: string } | undefined;

  for (const match of lines) {
    const lineStart = match.index;
    const lineEnd = lineStart + match[0].length;
    const nextLineStart = markdown[lineEnd] === "\r" ? lineEnd + 2 : lineEnd + 1;
    const info = match[2].trim();

    if (!opening) {
      opening = { start: lineStart, contentStart: nextLineStart, language: info };
      continue;
    }

    // 结束围栏不得携带语言或其他信息，否则仍视为新的非法围栏形态。
    if (info) {
      throw new ReportMarkdownFormatError("报告包含未闭合或嵌套的代码块。");
    }
    fences.push({
      ...opening,
      contentEnd: lineStart,
      end: lineEnd,
    });
    opening = undefined;
  }

  if (opening) {
    throw new ReportMarkdownFormatError("报告 HTML 代码块未闭合。");
  }
  return fences;
};

/** 严格解析唯一的非空 HTML 代码块；裸 HTML 与其他代码块均不会被自动修补。 */
export const parseReportMarkdown = (markdown: string): ParsedReportMarkdown => {
  const fences = findFences(markdown);
  if (fences.length !== 1) {
    throw new ReportMarkdownFormatError("报告必须包含且只能包含一个 HTML 代码块。");
  }

  const [fence] = fences;
  if (fence.language.toLowerCase() !== "html") {
    throw new ReportMarkdownFormatError("报告代码块必须使用 html 语言标识。");
  }

  const html = markdown.slice(fence.contentStart, fence.contentEnd).trim();
  if (!html) {
    throw new ReportMarkdownFormatError("报告 HTML 代码块不能为空。");
  }

  return {
    before: markdown.slice(0, fence.start),
    html,
    after: markdown.slice(fence.end),
  };
};

/** UI 使用无异常分支读取尚在流式传输或最终不合规的报告消息。 */
export const tryParseReportMarkdown = (markdown: string) => {
  try {
    return parseReportMarkdown(markdown);
  } catch (error) {
    if (error instanceof ReportMarkdownFormatError) return null;
    throw error;
  }
};

/** 将安全清洗后的 HTML 回填至模型原有 Markdown，保留代码块外的说明文字。 */
export const replaceReportHtml = (markdown: string, html: string) => {
  const parsed = parseReportMarkdown(markdown);
  return `${parsed.before}\`\`\`html\n${html.trim()}\n\`\`\`${parsed.after}`;
};

/** 最终交付始终执行安全处理；质量审查与自动修复是否启用不影响这条硬边界。 */
export const prepareReportMarkdownForDelivery = (
  markdown: string,
  html: string,
) => {
  const parsed = parseReportMarkdown(markdown);
  assertNoSourceDisclosure(`${parsed.before}\n${parsed.after}`);
  return replaceReportHtml(markdown, sanitizeReportHtml(html));
};

/**
 * 首次格式不合规时只允许模型重试一次；两次均失败时向工作流抛出稳定、可展示的错误。
 * generate 回调负责给第二次调用附加更严格的格式纠正提示。
 */
export async function generateReportMarkdownWithRetry<T extends { text: string }>(
  generate: (formatRetry: boolean) => Promise<T>,
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const generation = await generate(attempt === 1);
    try {
      return {
        generation,
        report: parseReportMarkdown(generation.text),
        attemptCount: attempt + 1,
      };
    } catch (error) {
      if (!(error instanceof ReportMarkdownFormatError) || attempt === 1) {
        throw new ReportMarkdownFormatError("报告生成格式不正确，请重新发起报告任务。");
      }
    }
  }

  // 循环逻辑保证不会到达此处，保留显式异常以防未来调整重试次数时静默返回。
  throw new ReportMarkdownFormatError("报告生成格式不正确，请重新发起报告任务。");
}
