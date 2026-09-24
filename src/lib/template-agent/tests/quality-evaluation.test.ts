import assert from "node:assert/strict";
import test from "node:test";
import { NoObjectGeneratedError } from "ai";
import {
  formatQualityEvaluationReply,
  getTemplateEvaluationAttempts,
  localizeQualityEvaluation,
  localizeTemplateFieldNames,
  MAX_EVALUATION_OUTPUT_RETRIES,
  MAX_OPTIMIZATION_ROUNDS,
  resolveTemplateEvaluation,
  runEvaluationWithStructuredOutputRetry,
} from "../quality-evaluation";

const createNoObjectGeneratedError = () => new NoObjectGeneratedError({
  message: "No object generated: could not parse the response.",
  cause: new SyntaxError("invalid JSON"),
  text: "{",
  response: {} as never,
  usage: {} as never,
  finishReason: "stop",
});

test("模板生成与调整默认最多执行两轮评价与优化", () => {
  assert.equal(MAX_OPTIMIZATION_ROUNDS, 2);
  assert.equal(MAX_EVALUATION_OUTPUT_RETRIES, 1);
});

test("零轮优化返回空评价次数并跳过模型评价", () => {
  assert.deepEqual(getTemplateEvaluationAttempts(0), []);
});

test("正数优化轮次生成从一开始的评价次数", () => {
  assert.deepEqual(getTemplateEvaluationAttempts(3), [1, 2, 3]);
});

test("评价通过时立即交付当前候选", () => {
  const decision = resolveTemplateEvaluation({
    evaluation: {
      passed: true,
      blockingIssues: [],
      fixInstructions: [],
    },
    evaluationAttempt: 1,
    maxRounds: MAX_OPTIMIZATION_ROUNDS,
  });

  assert.equal(decision.action, "accept");
  assert.deepEqual(decision.qualityEvaluation, {
    evaluationAttempt: 1,
    passed: true,
    blockingIssues: [],
    fixInstructions: [],
  });
});

test("末轮评价未通过时优化后直接交付且不要求下一次评价", () => {
  const evaluation = {
    passed: false,
    blockingIssues: ["存在阻塞问题。"],
    fixInstructions: ["修复阻塞问题。"],
  };

  assert.equal(
    resolveTemplateEvaluation({
      evaluation,
      evaluationAttempt: 1,
      maxRounds: 2,
    }).action,
    "optimize",
  );
  const finalDecision = resolveTemplateEvaluation({
    evaluation,
    evaluationAttempt: 2,
    maxRounds: 2,
  });
  assert.equal(finalDecision.action, "optimize_and_accept");
  assert.equal(finalDecision.qualityEvaluation.evaluationAttempt, 2);
});

test("模型声明通过但仍返回阻塞问题时按未通过处理", () => {
  const decision = resolveTemplateEvaluation({
    evaluation: {
      passed: true,
      blockingIssues: ["仍有阻塞问题。"],
      fixInstructions: [],
    },
    evaluationAttempt: 1,
    maxRounds: 2,
  });

  assert.equal(decision.qualityEvaluation.passed, false);
  assert.equal(decision.action, "optimize");
});

test("质量评价结构化输出失败一次后重试并返回成功结果", async () => {
  let calls = 0;
  const retries: number[] = [];
  const result = await runEvaluationWithStructuredOutputRetry({
    async execute(retryAttempt) {
      calls += 1;
      if (retryAttempt === 0) throw createNoObjectGeneratedError();
      return "评价成功";
    },
    onRetry(retryAttempt) {
      retries.push(retryAttempt);
    },
  });

  assert.equal(result, "评价成功");
  assert.equal(calls, 2);
  assert.deepEqual(retries, [1]);
});

test("质量评价结构化输出连续失败两次后抛出第二次错误", async () => {
  let calls = 0;
  await assert.rejects(
    runEvaluationWithStructuredOutputRetry({
      async execute() {
        calls += 1;
        throw createNoObjectGeneratedError();
      },
    }),
    NoObjectGeneratedError,
  );
  assert.equal(calls, 2);
});

test("质量评价普通异常不触发结构化输出重试", async () => {
  let calls = 0;
  await assert.rejects(
    runEvaluationWithStructuredOutputRetry({
      async execute() {
        calls += 1;
        throw new Error("network failed");
      },
    }),
    /network failed/,
  );
  assert.equal(calls, 1);
});

test("质量评价重试前响应用户取消", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    runEvaluationWithStructuredOutputRetry({
      abortSignal: controller.signal,
      async execute() {
        calls += 1;
        controller.abort();
        throw createNoObjectGeneratedError();
      },
    }),
    (error: unknown) => error instanceof DOMException && error.name === "AbortError",
  );
  assert.equal(calls, 1);
});

test("用户可见反馈会本地化八个字段的 camelCase 和 snake_case 名称", () => {
  const source = [
    "name/name",
    "description/description",
    "variables/variables",
    "explainStructure/explain_structure",
    "consistencyRules/consistency_rules",
    "constraintRules/constraint_rules",
    "exceptionBoundaryRules/exception_boundary_rules",
    "verificationRules/verification_rules",
  ].join("；");
  const localized = localizeTemplateFieldNames(source);

  assert.equal(
    localized,
    [
      "模板名称/模板名称",
      "用途描述/用途描述",
      "模板变量/模板变量",
      "报告结构/报告结构",
      "一致性规则/一致性规则",
      "核心约束/核心约束",
      "异常边界处理/异常边界处理",
      "交付校验规则/交付校验规则",
    ].join("；"),
  );
});

test("质量评价本地化不会修改原始反馈", () => {
  const evaluation = {
    evaluationAttempt: 1,
    passed: false,
    blockingIssues: ["explainStructure 缺少组件契约。"],
    fixInstructions: ["在 verification_rules 中补充检查项。"],
  };
  const localized = localizeQualityEvaluation(evaluation);

  assert.deepEqual(localized.blockingIssues, ["报告结构 缺少组件契约。"]);
  assert.deepEqual(localized.fixInstructions, [
    "在 交付校验规则 中补充检查项。",
  ]);
  assert.deepEqual(evaluation.blockingIssues, [
    "explainStructure 缺少组件契约。",
  ]);
});

test("消息流文本完整展示未通过评价的问题和建议", () => {
  const reply = formatQualityEvaluationReply("模板已保存，请手动调整。", {
    evaluationAttempt: 1,
    passed: false,
    blockingIssues: ["报告结构缺少组件示例。"],
    fixInstructions: ["为每个组件补充示例。"],
  });

  assert.match(reply, /质量评价：未通过（第 1 次评价）/);
  assert.match(reply, /发现的问题：\n- 报告结构缺少组件示例。/);
  assert.match(reply, /调整建议：\n- 为每个组件补充示例。/);
});
