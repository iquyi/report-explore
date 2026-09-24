import assert from "node:assert/strict";
import test from "node:test";
import {
  generateTextProtocolWithRetry,
  inspectReportTextProtocol,
  MAX_RESEARCH_FACTS,
  normalizeResearchLedgerFacts,
  parseMatchDecision,
  parseResearchLedger,
  parseReviewResult,
  repairResearchProtocolLocally,
  ReportTextProtocolFormatError,
  serializeResearchLedger,
} from "../report-text-protocol";

const researchText = `<<<SUMMARY>>>
第一行摘要
第二行摘要
<<<FACT>>>
<<<SOURCE_TYPE>>>
lx_tool
<<<SOURCE_LABEL>>>
企业档案
批次一
<<<STATEMENT>>>
企业成立于测试日期。
<<<END_FACT>>>
<<<FACT>>>
<<<SOURCE_TYPE>>>
web_search
<<<SOURCE_LABEL>>>
公开页面
<<<STATEMENT>>>
行业规模保持增长。
<<<END_FACT>>>
<<<CALCULATION>>>
<<<LABEL>>>
增长率
<<<FORMULA>>>
(本期-上期)/上期
<<<RESULT>>>
10%
<<<END_CALCULATION>>>
<<<LIMITATION>>>
缺少连续年度数据。
<<<END_LIMITATION>>>
<<<END_RESEARCH>>>`;

test("解析模板匹配协议并校验 matched 模板名称", () => {
  assert.deepEqual(
    parseMatchDecision(`<<<OUTCOME>>>
matched
<<<TEMPLATE_NAME>>>
企业画像模板
<<<MESSAGE>>>
已匹配模板
<<<END_MATCH>>>`),
    { outcome: "matched", templateName: "企业画像模板", message: "已匹配模板" },
  );
  assert.throws(
    () => parseMatchDecision(`<<<OUTCOME>>>
matched
<<<TEMPLATE_NAME>>>

<<<MESSAGE>>>
缺少模板
<<<END_MATCH>>>`),
    ReportTextProtocolFormatError,
  );
  assert.throws(
    () => parseMatchDecision(`<<<OUTCOME>>>
no_match
<<<TEMPLATE_NAME>>>
企业画像模板
<<<MESSAGE>>>
没有匹配项
<<<END_MATCH>>>`),
    /不得包含模板名称/,
  );
});

test("解析多行研究账本及重复事实、计算和限制块", () => {
  assert.deepEqual(parseResearchLedger(researchText), {
    summary: "第一行摘要\n第二行摘要",
    facts: [
      {
        sourceType: "lx_tool",
        sourceLabel: "企业档案\n批次一",
        statement: "企业成立于测试日期。",
      },
      {
        sourceType: "web_search",
        sourceLabel: "公开页面",
        statement: "行业规模保持增长。",
      },
    ],
    calculations: [{ label: "增长率", formula: "(本期-上期)/上期", result: "10%" }],
    limitations: ["缺少连续年度数据。"],
  });
});

test("解析 PASS 与 FAIL 审查协议", () => {
  assert.deepEqual(
    parseReviewResult(`<<<VERDICT>>>
PASS
<<<END_REVIEW>>>`),
    { passed: true, issues: [], repairInstructions: [] },
  );
  assert.deepEqual(
    parseReviewResult(`<<<VERDICT>>>
FAIL
<<<ISSUE>>>
缺少结论。
<<<END_ISSUE>>>
<<<REPAIR>>>
补充结论模块。
<<<END_REPAIR>>>
<<<END_REVIEW>>>`),
    { passed: false, issues: ["缺少结论。"], repairInstructions: ["补充结论模块。"] },
  );
  assert.throws(
    () => parseReviewResult(`<<<VERDICT>>>
FAIL
<<<END_REVIEW>>>`),
    /必须同时包含问题和修复指令/,
  );
});

test("拒绝空文本、缺失结束标记、未知枚举和块外内容", () => {
  assert.throws(() => parseResearchLedger(""), /空文本/);
  assert.throws(() => parseResearchLedger(researchText.replace("<<<END_RESEARCH>>>", "")), /结束标记/);
  assert.throws(() => parseResearchLedger(researchText.replace("lx_tool", "unknown")), /字段校验失败/);
  assert.throws(
    () => parseResearchLedger(researchText.replace("第一行摘要", "<<<UNKNOWN>>>")),
    /未知或嵌套/,
  );
  assert.throws(
    () => parseReviewResult(`<<<VERDICT>>>\nPASS\n额外内容\n<<<END_REVIEW>>>`),
    /PASS 或 FAIL|未知标记|块外内容/,
  );
});

test("协议诊断只包含长度与标记结构", () => {
  assert.deepEqual(inspectReportTextProtocol(researchText, "research"), {
    outputLength: researchText.length,
    markerCount: 19,
    isEmpty: false,
    hasEndMarker: true,
  });
});

test("本地修复移除外围文字、代码围栏、未知标记和块间文字", () => {
  const repaired = repairResearchProtocolLocally(`模型说明
\`\`\`text
<<<SUMMARY>>>
研究摘要
<<<UNKNOWN>>>
<<<FACT>>>
<<<SOURCE_TYPE>>>
lx_tool
<<<SOURCE_LABEL>>>
企业档案
<<<STATEMENT>>>
第一行事实
第二行事实
<<<END_FACT>>>
这一行位于块外
<<<CALCULATION>>>
<<<LABEL>>>
增长率
<<<FORMULA>>>
(本期-上期)/上期
<<<RESULT>>>
10%
<<<END_CALCULATION>>>
<<<END_RESEARCH>>>
\`\`\`
额外说明`);

  assert.equal(repaired.ledger.summary, "研究摘要");
  assert.equal(repaired.ledger.facts[0].statement, "第一行事实\n第二行事实");
  assert.equal(repaired.ledger.calculations[0].result, "10%");
  assert.deepEqual(parseResearchLedger(repaired.text), repaired.ledger);
  assert.equal(repaired.diagnostics.discardedBlockCount, 0);
});

test("本地修复补充协议结束标记并丢弃未闭合的尾部 FACT", () => {
  const repaired = repairResearchProtocolLocally(`<<<SUMMARY>>>
摘要
<<<FACT>>>
<<<SOURCE_TYPE>>>
web_search
<<<SOURCE_LABEL>>>
公开页面
<<<STATEMENT>>>
完整事实
<<<END_FACT>>>
<<<FACT>>>
<<<SOURCE_TYPE>>>
web_search
<<<SOURCE_LABEL>>>
另一页面
<<<STATEMENT>>>
未闭合事实`);

  assert.equal(repaired.ledger.facts.length, 1);
  assert.equal(repaired.ledger.facts[0].statement, "完整事实");
  assert.equal(repaired.diagnostics.originalBlockCount, 2);
  assert.equal(repaired.diagnostics.discardedBlockCount, 1);
  assert.match(repaired.text, /<<<END_RESEARCH>>>$/);
});

test("本地修复拒绝缺少摘要和完全不可恢复的数据块", () => {
  assert.throws(
    () => repairResearchProtocolLocally("<<<FACT>>>\n损坏内容\n<<<END_FACT>>>"),
    /缺少 SUMMARY/,
  );
  assert.throws(
    () => repairResearchProtocolLocally(`<<<SUMMARY>>>
摘要
<<<FACT>>>
缺少全部字段
<<<END_FACT>>>`),
    /没有可恢复的完整数据块/,
  );
});

test("事实按规范化正文去重并由高优先级来源替换且保持位置", () => {
  const normalized = normalizeResearchLedgerFacts({
    summary: "摘要",
    facts: [
      { statement: "ＡＣＭＥ   增长。", sourceType: "web_search", sourceLabel: "页面" },
      { statement: "第二条", sourceType: "mock_report", sourceLabel: "报告" },
      { statement: "acme 增长!", sourceType: "lx_tool", sourceLabel: "企业档案" },
    ],
    calculations: [],
    limitations: [],
  });

  assert.equal(normalized.diagnostics.duplicateFactCount, 1);
  assert.deepEqual(normalized.ledger.facts, [
    { statement: "acme 增长!", sourceType: "lx_tool", sourceLabel: "企业档案" },
    { statement: "第二条", sourceType: "mock_report", sourceLabel: "报告" },
  ]);
});

test("事实账本稳定截断到八十条并可重新序列化解析", () => {
  const normalized = normalizeResearchLedgerFacts({
    summary: "摘要",
    facts: Array.from({ length: MAX_RESEARCH_FACTS + 2 }, (_, index) => ({
      statement: `事实 ${index + 1}`,
      sourceType: "user" as const,
      sourceLabel: "用户输入",
    })),
    calculations: [],
    limitations: [],
  });

  assert.equal(normalized.ledger.facts.length, MAX_RESEARCH_FACTS);
  assert.equal(normalized.diagnostics.truncatedFactCount, 2);
  assert.deepEqual(
    parseResearchLedger(serializeResearchLedger(normalized.ledger)),
    normalized.ledger,
  );
});

test("协议首次失败时重试一次，第二次失败保留精确 cause", async () => {
  const attempts: boolean[] = [];
  const recovered = await generateTextProtocolWithRetry(
    async (formatRetry) => {
      attempts.push(formatRetry);
      return {
        text: formatRetry
          ? `<<<OUTCOME>>>\nno_match\n<<<TEMPLATE_NAME>>>\n\n<<<MESSAGE>>>\n无匹配模板\n<<<END_MATCH>>>`
          : "",
      };
    },
    parseMatchDecision,
    { protocol: "match" },
  );
  assert.deepEqual(attempts, [false, true]);
  assert.equal(recovered.parsed.outcome, "no_match");

  await assert.rejects(
    generateTextProtocolWithRetry(
      async () => ({ text: "" }),
      parseMatchDecision,
      { protocol: "match" },
    ),
    (error) => {
      assert.ok(error instanceof ReportTextProtocolFormatError);
      assert.ok(error.cause instanceof ReportTextProtocolFormatError);
      assert.match(error.cause.message, /空文本/);
      return true;
    },
  );
});
