import assert from "node:assert/strict";
import test from "node:test";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { createLxEnterpriseTools } from "../../lx-enterprise-tools";
import {
  createResearchAgent,
  generateHtmlReport,
  generateQualityReview,
  generateTemplateMatch,
} from "../subagents";
import {
  parseMatchDecision,
  parseResearchLedger,
  parseReviewResult,
} from "../report-text-protocol";

/** 为单次生成能力提供最小模型响应，避免测试访问真实模型。 */
const mockTextResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  finishReason: { unified: "stop" as const, raw: "stop" },
  warnings: [],
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
});

/** 所有报告子能力都必须显式开启 DeepSeek 思考模式。 */
const assertThinkingEnabled = (providerOptions: unknown) => {
  assert.deepEqual(providerOptions, {
    deepseek: { thinking: { type: "enabled" } },
  });
};

/** 测试注入本地工具替身，确保单元测试不会访问真实联网服务。 */
const createTestWebSearchTool = () =>
  tool({
    description: "测试联网搜索工具",
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => ({ query, results: [] }),
  });

test("只有 Research 使用 ToolLoopAgent 并同时拥有灵犀与联网工具", () => {
  const researcher = createResearchAgent({
    languageModel: new MockLanguageModelV4(),
    researchTools: createLxEnterpriseTools({ token: "test-token" }),
    webSearchTool: createTestWebSearchTool(),
  });

  assert.deepEqual(Object.keys(researcher.tools), [
    "resolveEnterpriseRegion",
    "advancedCompanySearch",
    "getCompanyRegistrationInformation",
    "getCompanyShareholders",
    "getCompanyCoreMembers",
    "getCompanySubsidiaries",
    "getCompanyOutwardInvestmentList",
    "tavilySearch",
  ]);
});

test("演示资料模式仍注册灵犀与联网工具并遵循补齐和冲突规则", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: mockTextResult(`<<<SUMMARY>>>
演示资料摘要
<<<FACT>>>
<<<SOURCE_TYPE>>>
mock_report
<<<SOURCE_LABEL>>>
示例报告.md
<<<STATEMENT>>>
示例事实
<<<END_FACT>>>
<<<END_RESEARCH>>>`),
  });
  const researcher = createResearchAgent({
    languageModel: model,
    researchTools: createLxEnterpriseTools({ token: "test-token" }),
    webSearchTool: createTestWebSearchTool(),
    demoSourceAvailable: true,
  });

  assert.equal(Object.keys(researcher.tools).includes("advancedCompanySearch"), true);
  assert.equal(Object.keys(researcher.tools).includes("tavilySearch"), true);
  const result = await researcher.generate({ prompt: "提取演示资料" });
  assert.equal(parseResearchLedger(result.text).facts[0].sourceType, "mock_report");
  assert.notEqual(model.doGenerateCalls[0].tools, undefined);
  assert.equal(model.doGenerateCalls[0].responseFormat, undefined);
  assert.equal(model.doGenerateCalls[0].maxOutputTokens, 32_768);
  assertThinkingEnabled(model.doGenerateCalls[0].providerOptions);
  const researchInstructions = model.doGenerateCalls[0].prompt
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");
  assert.match(researchInstructions, /优先调用灵犀工具/);
  assert.match(researchInstructions, /缺失字段、时间缺口/);
  assert.match(researchInstructions, /无法判断时效或时间相同时，采用演示资料/);
  assert.match(researchInstructions, /禁止使用模型背景知识补造事实/);
  assert.match(researchInstructions, /所有来源信息只能放在 sourceType 与 sourceLabel 中/);
  assert.match(researchInstructions, /禁止继承或复述其目录层级/);
  assert.match(researchInstructions, /最多执行 8 个不同的联网查询/);
  assert.match(researchInstructions, /总数不得超过 80 条/);
});

test("模板匹配通过普通文本协议生成且不启用 JSON Output", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: mockTextResult(`<<<OUTCOME>>>
matched
<<<TEMPLATE_NAME>>>
企业画像模板
<<<MESSAGE>>>
已匹配
<<<END_MATCH>>>`),
  });

  const result = await generateTemplateMatch({ prompt: "匹配模板" }, model);

  assert.equal(parseMatchDecision(result.text).templateName, "企业画像模板");
  assert.equal(model.doGenerateCalls.length, 1);
  assert.equal(model.doGenerateCalls[0].tools, undefined);
  assert.equal(model.doGenerateCalls[0].responseFormat, undefined);
  assertThinkingEnabled(model.doGenerateCalls[0].providerOptions);
});

test("HTML Writer 明确要求模型输出唯一 Markdown HTML 代码块", async () => {
  const markdown = "```html\n<!doctype html><html><head><title>测试</title></head><body></body></html>\n```";
  const model = new MockLanguageModelV4({ doGenerate: mockTextResult(markdown) });

  const result = await generateHtmlReport(
    "测试设计规范",
    { prompt: "生成报告" },
    model,
  );

  assert.equal(result.text, markdown);
  assert.equal(model.doGenerateCalls.length, 1);
  assert.equal(model.doGenerateCalls[0].tools, undefined);
  assertThinkingEnabled(model.doGenerateCalls[0].providerOptions);
  const writerInstructions = model.doGenerateCalls[0].prompt
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");
  assert.match(writerInstructions, /数据库 template 是报告章节/);
  assert.match(writerInstructions, /事实账本只提供模板各章节所需的事实证据/);
  assert.match(writerInstructions, /禁止推断、复刻或恢复原始 mock 成品/);
  assert.match(writerInstructions, /禁止输出任何外部链接、URL、引用/);
  assert.match(writerInstructions, /来源隐藏规则优先于模板规则/);
  assert.match(writerInstructions, /一个且仅一个以 ```html 开始/);
  assert.match(writerInstructions, /禁止输出裸 HTML/);
});

test("格式重试会向 Writer 增加明确的纠正约束", async () => {
  const markdown = "```html\n<html><head><title>测试</title></head><body></body></html>\n```";
  const model = new MockLanguageModelV4({ doGenerate: mockTextResult(markdown) });

  await generateHtmlReport(
    "测试设计规范",
    { prompt: "纠正格式", formatRetry: true },
    model,
  );

  const writerInstructions = model.doGenerateCalls[0].prompt
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");
  assert.match(writerInstructions, /上一次输出违反格式协议/);
});

test("质量审查通过普通文本协议生成且不启用 JSON Output", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: mockTextResult(`<<<VERDICT>>>
PASS
<<<END_REVIEW>>>`),
  });

  const result = await generateQualityReview({ prompt: "审查报告" }, model);

  assert.equal(parseReviewResult(result.text).passed, true);
  assert.equal(model.doGenerateCalls.length, 1);
  assert.equal(model.doGenerateCalls[0].tools, undefined);
  assert.equal(model.doGenerateCalls[0].responseFormat, undefined);
  assertThinkingEnabled(model.doGenerateCalls[0].providerOptions);
  const reviewerInstructions = model.doGenerateCalls[0].prompt
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");
  assert.match(reviewerInstructions, /来源隐藏规则优先于模板规则/);
  assert.match(reviewerInstructions, /渠道或工具名称/);
});
