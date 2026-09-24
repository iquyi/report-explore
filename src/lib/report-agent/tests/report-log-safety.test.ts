import assert from "node:assert/strict";
import test from "node:test";
import {
  createResearchFactBodyLogEntries,
  describeReportError,
  sanitizeReportErrorMessage,
} from "../report-log-safety";

test("JSON 解析错误日志移除模型正文并保留语法原因", () => {
  const sensitiveText = "企业敏感研究正文";
  const message = `JSON parsing failed: Text: ${sensitiveText}.\nError message: Expected ',' at position 12`;
  const sanitized = sanitizeReportErrorMessage(message);

  assert.equal(sanitized, "JSON parsing failed: Expected ',' at position 12");
  assert.equal(sanitized.includes(sensitiveText), false);
});

test("错误链只记录安全的最外层和最内层原因", () => {
  const syntaxError = new SyntaxError("Unexpected token at position 7");
  const parseError = new Error(
    "JSON parsing failed: Text: 私密正文。\nError message: Unexpected token",
    { cause: syntaxError },
  );
  parseError.name = "AI_JSONParseError";
  const outerError = new Error("No object generated", { cause: parseError });
  outerError.name = "AI_NoObjectGeneratedError";

  assert.deepEqual(describeReportError(outerError), {
    errorName: "AI_NoObjectGeneratedError",
    errorMessage: "No object generated",
    causeName: "SyntaxError",
    causeMessage: "Unexpected token at position 7",
  });
});

test("仅开发环境记录完整事实正文且不接收来源标识", () => {
  const statement = "第一行完整事实\n第二行完整事实";
  const facts = [{
    statement,
    sourceType: "lx_tool" as const,
    sourceLabel: "不应进入日志的内部来源",
  }];

  const developmentEntries = createResearchFactBodyLogEntries(
    "workflow-1",
    facts,
    "development",
  );
  assert.deepEqual(developmentEntries, [{
    workflowId: "workflow-1",
    factIndex: 1,
    sourceType: "lx_tool",
    statement,
  }]);
  assert.equal(JSON.stringify(developmentEntries).includes(facts[0].sourceLabel), false);
  assert.deepEqual(
    createResearchFactBodyLogEntries("workflow-1", facts, "production"),
    [],
  );
  assert.deepEqual(createResearchFactBodyLogEntries("workflow-1", facts, "test"), []);
});
