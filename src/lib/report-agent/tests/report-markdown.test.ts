import assert from "node:assert/strict";
import test from "node:test";
import {
  generateReportMarkdownWithRetry,
  parseReportMarkdown,
  prepareReportMarkdownForDelivery,
  replaceReportHtml,
  ReportMarkdownFormatError,
} from "../report-markdown";

const html = "<!doctype html><html><head><title>测试报告</title></head><body>正文</body></html>";

test("解析唯一 HTML 代码块并保留块外 Markdown", () => {
  assert.deepEqual(parseReportMarkdown(`# 说明\n\n\`\`\`html\n${html}\n\`\`\`\n\n完成`), {
    before: "# 说明\n\n",
    html,
    after: "\n\n完成",
  });
});

test("拒绝裸 HTML、未闭合围栏、多个代码块、空块和非 HTML 代码块", () => {
  const invalidReports = [
    html,
    `\`\`\`html\n${html}`,
    `\`\`\`html\n${html}\n\`\`\`\n\`\`\`html\n${html}\n\`\`\``,
    "```html\n\n```",
    `\`\`\`xml\n${html}\n\`\`\``,
  ];

  for (const markdown of invalidReports) {
    assert.throws(() => parseReportMarkdown(markdown), ReportMarkdownFormatError);
  }
});

test("安全 HTML 回填后保持代码块外 Markdown 不变", () => {
  const markdown = `前言\n\n\`\`\`html\n${html}\n\`\`\`\n\n结语`;
  const safeHtml = "<!doctype html><html><body>安全正文</body></html>";

  assert.equal(
    replaceReportHtml(markdown, safeHtml),
    `前言\n\n\`\`\`html\n${safeHtml}\n\`\`\`\n\n结语`,
  );
});

test("无论质量审查是否启用都执行最终安全处理", () => {
  const disclosureHtml = "<html><body><p>数据来源：内部平台</p></body></html>";
  const markdown = `\`\`\`html\n${disclosureHtml}\n\`\`\``;

  assert.throws(
    () => prepareReportMarkdownForDelivery(markdown, disclosureHtml),
    /不可展示的数据来源信息/,
  );
});

test("首次格式错误时重试一次并接受第二次合法结果", async () => {
  const calls: boolean[] = [];
  const result = await generateReportMarkdownWithRetry(async (formatRetry) => {
    calls.push(formatRetry);
    return { text: formatRetry ? `\`\`\`html\n${html}\n\`\`\`` : html };
  });

  assert.deepEqual(calls, [false, true]);
  assert.equal(result.attemptCount, 2);
  assert.equal(result.report.html, html);
});

test("第二次格式仍错误时明确失败且不再重试", async () => {
  let callCount = 0;

  await assert.rejects(
    generateReportMarkdownWithRetry(async () => {
      callCount += 1;
      return { text: html };
    }),
    /报告生成格式不正确/,
  );
  assert.equal(callCount, 2);
});
