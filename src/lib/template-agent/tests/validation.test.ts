import assert from "node:assert/strict";
import test from "node:test";
import { TEMPLATE_FIELD_LIMITS } from "../limits";
import { buildTemplateValidationPrompt } from "../prompts";
import {
  getDeterministicValidationIssues,
  validateTemplateContent,
} from "../schema";
import type { TemplateAgentContent } from "../types";

/** 提供语义验证和确定性校验共用的最小完整模板，单项测试只覆盖目标字段。 */
const createTemplate = (): TemplateAgentContent => ({
  name: "经营分析报告",
  description: "面向管理人员生成经营情况分析报告。",
  variables: [{ key: "统计周期", value: "报告覆盖的时间范围。" }],
  explainStructure: "报告包含经营概览和重点问题。",
  consistencyRules: "相同指标在不同模块使用同一数据来源。",
  constraintRules: "不得虚构缺失的经营数据。",
  exceptionBoundaryRules: "数据缺失时披露缺口，不推断具体数值。",
  verificationRules: "交付前检查关键指标是否可追溯。",
});

test("发布验证只检查字段整体语义并排除报告结构与四类规则的严格映射", () => {
  const messages = buildTemplateValidationPrompt({
    current: createTemplate(),
    deterministicIssues: [],
  });

  assert.match(messages.prompt, /只对每个字段的整体语义进行检查/);
  assert.match(messages.prompt, /不要检查字段之间的细粒度映射/);
  assert.match(
    messages.prompt,
    /不得因为报告结构没有逐项体现或引用一致性规则、核心约束、异常边界处理、交付校验规则而判定失败/,
  );
  assert.match(messages.prompt, /不要按照完整生成指南逐条审查内容粒度/);
});

test("发布验证仍会确定性拦截空必填字段", () => {
  const template = createTemplate();
  template.description = "";
  template.explainStructure = "";

  const issues = getDeterministicValidationIssues(template);

  assert.ok(issues.some((issue) => issue.field === "description"));
  assert.ok(issues.some((issue) => issue.field === "explainStructure"));
});

test("发布验证仍会确定性拦截超长字段", () => {
  const template = createTemplate();
  template.explainStructure = "结".repeat(
    TEMPLATE_FIELD_LIMITS.explainStructure + 1,
  );

  const result = validateTemplateContent(template);

  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.issues.some((issue) => issue.field === "explainStructure"));
  }
});

test("发布验证仍会确定性拦截重复变量名", () => {
  const template = createTemplate();
  template.variables.push({
    key: "统计周期",
    value: "重复定义的时间范围。",
  });

  const result = validateTemplateContent(template);

  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.issues.some((issue) => issue.field === "variables"));
  }
});
