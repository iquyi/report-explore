import assert from "node:assert/strict";
import test from "node:test";
import {
  createDesignStyleMatchCandidates,
  createReportWriterPrompt,
  createReportRuntimeContext,
  createTemplateMatchCandidates,
  findDesignStyleById,
  findExplicitDesignStyle,
  getNextReportPhase,
  MAX_REPORT_WORKFLOW_STEPS,
  REPORT_REVIEW_AND_REPAIR_ENABLED,
  resolveDesignStyle,
} from "../orchestration";

test("审查关闭时，确定性流程在初稿完成后直接交付", () => {
  assert.equal(REPORT_REVIEW_AND_REPAIR_ENABLED, false);
  assert.equal(getNextReportPhase("match", "success"), "match-style");
  assert.equal(getNextReportPhase("match-style", "success"), "research");
  assert.equal(getNextReportPhase("research", "success"), "write-draft");
  assert.equal(getNextReportPhase("write-draft", "success"), "deliver");
});

test("重新开启审查时，初稿仍进入原有质量检查链路", () => {
  assert.equal(
    getNextReportPhase("write-draft", "success", true),
    "review-draft",
  );
  assert.equal(getNextReportPhase("review-draft", "passed"), "deliver");
});

test("初审失败只修复一次，复审无论结果都进入交付", () => {
  assert.equal(getNextReportPhase("review-draft", "rejected"), "write-repair");
  assert.equal(getNextReportPhase("write-repair", "success"), "review-repair");
  assert.equal(getNextReportPhase("review-repair", "passed"), "deliver");
  assert.equal(getNextReportPhase("review-repair", "rejected"), "deliver");
});

test("子能力失败统一进入 fail，终态完成后进入 done", () => {
  assert.equal(getNextReportPhase("match", "error"), "fail");
  assert.equal(getNextReportPhase("match-style", "error"), "fail");
  assert.equal(getNextReportPhase("research", "error"), "fail");
  assert.equal(getNextReportPhase("write-draft", "error"), "fail");
  assert.equal(getNextReportPhase("review-repair", "error"), "fail");
  assert.equal(getNextReportPhase("fail", "complete"), "done");
});

test("状态机使用十三步安全上限并拒绝非法转换", () => {
  assert.equal(MAX_REPORT_WORKFLOW_STEPS, 13);
  assert.throws(
    () => getNextReportPhase("research", "passed"),
    /非法的报告状态转换/,
  );
});

const designStyles = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    name: "蓝色科技风格",
    description: "克制的蓝色科技设计",
    promptRules: "蓝色规则正文",
    isDefault: true,
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    name: "蓝色科技风格增强版",
    description: "更适合信息密集报告",
    promptRules: "增强规则正文",
    isDefault: false,
  },
];

test("风格匹配候选不包含 Prompt Rules 和默认标记", () => {
  assert.deepEqual(createDesignStyleMatchCandidates(designStyles), [
    {
      id: "10000000-0000-4000-8000-000000000001",
      name: "蓝色科技风格",
      description: "克制的蓝色科技设计",
    },
    {
      id: "10000000-0000-4000-8000-000000000002",
      name: "蓝色科技风格增强版",
      description: "更适合信息密集报告",
    },
  ]);
});

test("明确指定完整风格名称时长名称优先", () => {
  assert.equal(
    findExplicitDesignStyle("请使用蓝色科技风格增强版", designStyles)?.id,
    "10000000-0000-4000-8000-000000000002",
  );
  assert.equal(findExplicitDesignStyle("生成普通报告", designStyles), undefined);
});

test("用户指定风格 ID 时只精确命中当前启用候选", () => {
  assert.equal(
    findDesignStyleById(
      designStyles,
      "10000000-0000-4000-8000-000000000002",
    )?.name,
    "蓝色科技风格增强版",
  );
  assert.equal(
    findDesignStyleById(
      designStyles,
      "10000000-0000-4000-8000-000000000099",
    ),
    undefined,
  );
});

test("无匹配或无效 ID 时回退默认风格", () => {
  assert.equal(
    resolveDesignStyle(designStyles, "10000000-0000-4000-8000-000000000002")?.isDefault,
    false,
  );
  assert.equal(resolveDesignStyle(designStyles, null)?.isDefault, true);
  assert.equal(
    resolveDesignStyle(designStyles, "10000000-0000-4000-8000-000000000099")?.isDefault,
    true,
  );
});

test("运行时上下文按 Asia/Shanghai 生成当前日期", () => {
  assert.deepEqual(
    createReportRuntimeContext(new Date("2026-09-18T16:30:00.000Z")),
    { currentDate: "2026-09-19", timeZone: "Asia/Shanghai" },
  );
});

test("模板匹配候选只包含 name 和 description", () => {
  const candidates = createTemplateMatchCandidates([
    {
      id: "template-id",
      name: "企业画像模板",
      description: "用于生成企业画像报告",
      variables: [{ key: "统一社会信用代码", value: "主体标识" }],
      explainStructure: "完整结构",
      consistencyRules: "一致性规则",
      constraintRules: "约束规则",
      exceptionBoundaryRules: "异常规则",
      verificationRules: "校验规则",
    },
  ]);

  assert.deepEqual(candidates, [
    { name: "企业画像模板", description: "用于生成企业画像报告" },
  ]);
});

test("Writer 上下文只包含数据库模板与事实账本，不包含 mock 成品原文", () => {
  const runtimeContext = createReportRuntimeContext(
    new Date("2026-09-18T16:30:00.000Z"),
  );
  const prompt = createReportWriterPrompt({
    request: "生成月之暗面企业画像报告",
    runtimeContext,
    templateArtifact: {
      template: {
        id: "template-id",
        name: "企业画像模板",
        description: "用于生成企业画像报告",
        variables: [],
        explainStructure: "严格章节结构",
        consistencyRules: "一致性规则",
        constraintRules: "约束规则",
        exceptionBoundaryRules: "异常规则",
        verificationRules: "校验规则",
      },
      variableValues: {},
    },
    research: {
      summary: "仅保留按模板筛选后的事实摘要",
      facts: [
        {
          statement: "结构化事实",
          sourceType: "mock_report",
          sourceLabel: "月之暗面企业画像报告.md",
        },
      ],
      calculations: [],
      limitations: [],
    },
  });
  const context = JSON.parse(prompt) as Record<string, unknown>;

  assert.equal("mockSource" in context, false);
  assert.equal("content" in context, false);
  assert.equal(
    (context.template as { explainStructure: string }).explainStructure,
    "严格章节结构",
  );
  const presentationResearch = context.research as {
    facts: Array<Record<string, unknown>>;
  };
  assert.deepEqual(presentationResearch.facts, [{ statement: "结构化事实" }]);
  assert.equal("sourceType" in presentationResearch.facts[0], false);
  assert.equal("sourceLabel" in presentationResearch.facts[0], false);
});
