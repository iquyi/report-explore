import { z } from "zod";
import type { ResearchLedger, ReviewResult } from "./types";

export type ReportTextProtocol = "match" | "style-match" | "research" | "review";

export type MatchDecision = {
  outcome: "matched" | "no_match" | "unsupported_adjustment";
  templateName: string | null;
  message: string;
};

export type StyleMatchDecision = {
  outcome: "matched" | "no_match";
  styleId: string | null;
  message: string;
};

export type ReportTextProtocolDiagnostics = {
  outputLength: number;
  markerCount: number;
  isEmpty: boolean;
  hasEndMarker: boolean;
};

/** 使用专用错误类型区分模型协议违规与网络、工具等运行时错误。 */
export class ReportTextProtocolFormatError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReportTextProtocolFormatError";
  }
}

const matchSchema = z.object({
  outcome: z.enum(["matched", "no_match", "unsupported_adjustment"]),
  templateName: z.string().nullable(),
  message: z.string().min(1),
}).superRefine((value, context) => {
  if (value.outcome === "matched" && !value.templateName) {
    context.addIssue({
      code: "custom",
      message: "matched 结果必须包含模板名称。",
      path: ["templateName"],
    });
  } else if (value.outcome !== "matched" && value.templateName) {
    context.addIssue({
      code: "custom",
      message: "非 matched 结果不得包含模板名称。",
      path: ["templateName"],
    });
  }
});

const styleMatchSchema = z.object({
  outcome: z.enum(["matched", "no_match"]),
  styleId: z.string().uuid().nullable(),
  message: z.string().min(1),
}).superRefine((value, context) => {
  if (value.outcome === "matched" && !value.styleId) {
    context.addIssue({
      code: "custom",
      message: "matched 结果必须包含风格 ID。",
      path: ["styleId"],
    });
  } else if (value.outcome !== "matched" && value.styleId) {
    context.addIssue({
      code: "custom",
      message: "非 matched 结果不得包含风格 ID。",
      path: ["styleId"],
    });
  }
});

const researchFactSchema = z.object({
  statement: z.string().min(1),
  sourceType: z.enum(["user", "lx_tool", "mock_report", "web_search"]),
  sourceLabel: z.string().min(1),
});

const researchCalculationSchema = z.object({
  label: z.string().min(1),
  formula: z.string().min(1),
  result: z.string().min(1),
});

const researchSchema = z.object({
  summary: z.string().min(1),
  facts: z.array(researchFactSchema),
  calculations: z.array(researchCalculationSchema),
  limitations: z.array(z.string().min(1)),
});

export const MAX_RESEARCH_FACTS = 80;

const reviewSchema = z.object({
  passed: z.boolean(),
  issues: z.array(z.string().min(1)),
  repairInstructions: z.array(z.string().min(1)),
}).superRefine((value, context) => {
  if (value.passed && (value.issues.length > 0 || value.repairInstructions.length > 0)) {
    context.addIssue({
      code: "custom",
      message: "PASS 结果不得包含问题或修复指令。",
      path: ["passed"],
    });
  } else if (!value.passed && (value.issues.length === 0 || value.repairInstructions.length === 0)) {
    context.addIssue({
      code: "custom",
      message: "FAIL 结果必须同时包含问题和修复指令。",
      path: ["passed"],
    });
  }
});

const endMarkers: Record<ReportTextProtocol, string> = {
  match: "<<<END_MATCH>>>",
  "style-match": "<<<END_STYLE_MATCH>>>",
  research: "<<<END_RESEARCH>>>",
  review: "<<<END_REVIEW>>>",
};

export const MATCH_TEXT_PROTOCOL = `仅输出以下纯文本协议，不得输出 JSON、Markdown 代码块或额外说明：
<<<OUTCOME>>>
matched、no_match 或 unsupported_adjustment 三者之一
<<<TEMPLATE_NAME>>>
匹配时填写候选模板原名；其他结果留空
<<<MESSAGE>>>
面向用户的简短说明
<<<END_MATCH>>>`;

export const STYLE_MATCH_TEXT_PROTOCOL = `仅输出以下纯文本协议，不得输出 JSON、Markdown 代码块或额外说明：
<<<OUTCOME>>>
matched 或 no_match 二者之一
<<<STYLE_ID>>>
匹配时填写候选风格的完整 ID；no_match 时留空
<<<MESSAGE>>>
简短说明匹配依据
<<<END_STYLE_MATCH>>>`;

export const RESEARCH_TEXT_PROTOCOL = `最终答案仅输出以下纯文本协议，不得输出 JSON、Markdown 代码块或额外说明。字段内容不得包含形如 <<<NAME>>> 的协议标记：
<<<SUMMARY>>>
研究摘要，可包含多行
<<<FACT>>>
<<<SOURCE_TYPE>>>
user、lx_tool、mock_report 或 web_search 四者之一
<<<SOURCE_LABEL>>>
来源标识，可包含多行
<<<STATEMENT>>>
原子事实，可包含多行
<<<END_FACT>>>
可重复零到多个 FACT 块
<<<CALCULATION>>>
<<<LABEL>>>
计算名称
<<<FORMULA>>>
计算公式
<<<RESULT>>>
计算结果
<<<END_CALCULATION>>>
可重复零到多个 CALCULATION 块
<<<LIMITATION>>>
单项限制，可包含多行
<<<END_LIMITATION>>>
可重复零到多个 LIMITATION 块
<<<END_RESEARCH>>>`;

export const REVIEW_TEXT_PROTOCOL = `仅输出以下纯文本协议，不得输出 JSON、Markdown 代码块或额外说明。字段内容不得包含形如 <<<NAME>>> 的协议标记：
<<<VERDICT>>>
PASS 或 FAIL
<<<ISSUE>>>
单项问题，可包含多行
<<<END_ISSUE>>>
可重复零到多个 ISSUE 块
<<<REPAIR>>>
单项修复指令，可包含多行
<<<END_REPAIR>>>
可重复零到多个 REPAIR 块
<<<END_REVIEW>>>`;

const normalize = (text: string) => text.replace(/\r\n?/g, "\n").trim();

const requireText = (text: string) => {
  const normalized = normalize(text);
  if (!normalized) {
    throw new ReportTextProtocolFormatError("模型返回了空文本。");
  }
  return normalized;
};

const assertNoProtocolMarker = (value: string, label: string) => {
  if (/^<<<[A-Z_]+>>>$/m.test(value)) {
    throw new ReportTextProtocolFormatError(`${label}包含未知或嵌套的协议标记。`);
  }
};

/** Zod 只负责字段约束；这里把错误压缩为不包含业务正文的稳定诊断。 */
const validate = <T>(schema: z.ZodType<T>, value: unknown, label: string): T => {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new ReportTextProtocolFormatError(
    `${label}字段校验失败：${issue.path.join(".") || "root"} ${issue.message}`,
  );
};

const parseFixedSections = (
  text: string,
  markers: readonly string[],
  endMarker: string,
) => {
  const normalized = requireText(text);
  const escapedMarkers = markers.map((marker) => marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(
    `^${escapedMarkers.map((marker, index) => `${marker}\\n([\\s\\S]*?)${index === markers.length - 1 ? `\\n${endMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$` : `\\n(?=${escapedMarkers[index + 1]}\\n)`}`).join("")}`,
  );
  const match = normalized.match(pattern);
  if (!match) {
    throw new ReportTextProtocolFormatError("文本缺少必需标记、标记顺序错误或存在额外内容。");
  }
  return match.slice(1).map((value, index) => {
    const trimmed = value.trim();
    assertNoProtocolMarker(trimmed, markers[index]);
    return trimmed;
  });
};

type RepeatingBlock = {
  marker: string;
  endMarker: string;
  body: string;
};

/** 按独立行标记扫描重复块，拒绝块外文本和未闭合块。 */
const parseRepeatingBlocks = (
  text: string,
  protocolEndMarker: string,
  allowedBlocks: ReadonlyArray<{ marker: string; endMarker: string }>,
) => {
  let remaining = text.trim();
  const blocks: RepeatingBlock[] = [];

  while (remaining !== protocolEndMarker) {
    const block = allowedBlocks.find(({ marker }) => remaining.startsWith(`${marker}\n`));
    if (!block) {
      throw new ReportTextProtocolFormatError("文本包含未知标记、块外内容或缺少协议结束标记。");
    }
    const bodyStart = block.marker.length + 1;
    const closingToken = `\n${block.endMarker}`;
    const bodyEnd = remaining.indexOf(closingToken, bodyStart);
    if (bodyEnd < 0) {
      throw new ReportTextProtocolFormatError(`${block.marker} 块未闭合。`);
    }
    blocks.push({ ...block, body: remaining.slice(bodyStart, bodyEnd).trim() });
    remaining = remaining.slice(bodyEnd + closingToken.length).trimStart();
  }
  return blocks;
};

export const inspectReportTextProtocol = (
  text: string,
  protocol: ReportTextProtocol,
): ReportTextProtocolDiagnostics => {
  const normalized = normalize(text);
  return {
    outputLength: text.length,
    markerCount: [...normalized.matchAll(/^<<<[A-Z_]+>>>$/gm)].length,
    isEmpty: normalized.length === 0,
    hasEndMarker: normalized.endsWith(endMarkers[protocol]),
  };
};

export const parseMatchDecision = (text: string): MatchDecision => {
  const [outcome, templateName, message] = parseFixedSections(
    text,
    ["<<<OUTCOME>>>", "<<<TEMPLATE_NAME>>>", "<<<MESSAGE>>>"] as const,
    endMarkers.match,
  );
  return validate(matchSchema, {
    outcome,
    templateName: templateName || null,
    message,
  }, "模板匹配协议");
};

export const parseStyleMatchDecision = (text: string): StyleMatchDecision => {
  const [outcome, styleId, message] = parseFixedSections(
    text,
    ["<<<OUTCOME>>>", "<<<STYLE_ID>>>", "<<<MESSAGE>>>"] as const,
    endMarkers["style-match"],
  );
  return validate(styleMatchSchema, {
    outcome,
    styleId: styleId || null,
    message,
  }, "设计风格匹配协议");
};

export const parseResearchLedger = (text: string): ResearchLedger => {
  const normalized = requireText(text);
  if (!normalized.startsWith("<<<SUMMARY>>>\n")) {
    throw new ReportTextProtocolFormatError("研究协议必须以 SUMMARY 标记开始。");
  }
  const firstBlockMarkers = [
    "<<<FACT>>>",
    "<<<CALCULATION>>>",
    "<<<LIMITATION>>>",
    endMarkers.research,
  ];
  const firstBlockIndex = firstBlockMarkers
    .map((marker) => normalized.indexOf(`\n${marker}`))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  if (firstBlockIndex === undefined) {
    throw new ReportTextProtocolFormatError("研究协议缺少结束标记。");
  }

  const summary = normalized.slice("<<<SUMMARY>>>\n".length, firstBlockIndex).trim();
  assertNoProtocolMarker(summary, "SUMMARY");
  const blocks = parseRepeatingBlocks(
    normalized.slice(firstBlockIndex + 1),
    endMarkers.research,
    [
      { marker: "<<<FACT>>>", endMarker: "<<<END_FACT>>>" },
      { marker: "<<<CALCULATION>>>", endMarker: "<<<END_CALCULATION>>>" },
      { marker: "<<<LIMITATION>>>", endMarker: "<<<END_LIMITATION>>>" },
    ],
  );

  const facts = blocks.filter(({ marker }) => marker === "<<<FACT>>>").map(({ body }) => {
    const [sourceType, sourceLabel, statement] = parseFixedSections(
      `${body}\n<<<END_FACT_FIELDS>>>`,
      ["<<<SOURCE_TYPE>>>", "<<<SOURCE_LABEL>>>", "<<<STATEMENT>>>"] as const,
      "<<<END_FACT_FIELDS>>>",
    );
    return { sourceType, sourceLabel, statement };
  });
  const calculations = blocks
    .filter(({ marker }) => marker === "<<<CALCULATION>>>")
    .map(({ body }) => {
      const [label, formula, result] = parseFixedSections(
        `${body}\n<<<END_CALCULATION_FIELDS>>>`,
        ["<<<LABEL>>>", "<<<FORMULA>>>", "<<<RESULT>>>"] as const,
        "<<<END_CALCULATION_FIELDS>>>",
      );
      return { label, formula, result };
    });
  const limitations = blocks
    .filter(({ marker }) => marker === "<<<LIMITATION>>>")
    .map(({ body }) => {
      assertNoProtocolMarker(body, "LIMITATION");
      return body;
    });

  return validate(researchSchema, { summary, facts, calculations, limitations }, "研究协议");
};

export type ResearchProtocolRepairDiagnostics = {
  discardedBlockCount: number;
  originalBlockCount: number;
  recoveredBlockCount: number;
};

export type ResearchLedgerNormalizationDiagnostics = {
  duplicateFactCount: number;
  truncatedFactCount: number;
};

const protocolMarkerLine = /^<<<[A-Z_]+>>>$/;

/** 只移除协议控制行，不触碰模型生成的实际字段正文。 */
const removeUnknownMarkerLines = (text: string, allowedMarkers: ReadonlySet<string>) =>
  text
    .split("\n")
    .filter((line) => {
      const marker = line.trim();
      return !protocolMarkerLine.test(marker) || allowedMarkers.has(marker);
    })
    .join("\n")
    .trim();

type LooseResearchBlock = {
  kind: "fact" | "calculation" | "limitation";
  body: string;
  index: number;
};

const looseBlockDefinitions = [
  { kind: "fact", marker: "<<<FACT>>>", endMarker: "<<<END_FACT>>>" },
  {
    kind: "calculation",
    marker: "<<<CALCULATION>>>",
    endMarker: "<<<END_CALCULATION>>>",
  },
  {
    kind: "limitation",
    marker: "<<<LIMITATION>>>",
    endMarker: "<<<END_LIMITATION>>>",
  },
] as const;

/** 从任意位置提取闭合块；块间说明文字不会被带入修复后的协议。 */
const collectCompleteResearchBlocks = (text: string) => {
  const blocks: LooseResearchBlock[] = [];
  for (const definition of looseBlockDefinitions) {
    const marker = definition.marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const endMarker = definition.endMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `^${marker}[ \\t]*\\n([\\s\\S]*?)^${endMarker}[ \\t]*$`,
      "gm",
    );
    for (const match of text.matchAll(pattern)) {
      blocks.push({
        kind: definition.kind,
        body: match[1].trim(),
        index: match.index,
      });
    }
  }
  return blocks.sort((left, right) => left.index - right.index);
};

const countResearchBlockOpeners = (text: string) =>
  [...text.matchAll(/^<<<(?:FACT|CALCULATION|LIMITATION)>>>[ \t]*$/gm)].length;

/** 将可信账本序列化成唯一的标准研究协议，供本地修复后再次执行严格解析。 */
export const serializeResearchLedger = (ledger: ResearchLedger) => [
  "<<<SUMMARY>>>",
  ledger.summary,
  ...ledger.facts.flatMap((fact) => [
    "<<<FACT>>>",
    "<<<SOURCE_TYPE>>>",
    fact.sourceType,
    "<<<SOURCE_LABEL>>>",
    fact.sourceLabel,
    "<<<STATEMENT>>>",
    fact.statement,
    "<<<END_FACT>>>",
  ]),
  ...ledger.calculations.flatMap((calculation) => [
    "<<<CALCULATION>>>",
    "<<<LABEL>>>",
    calculation.label,
    "<<<FORMULA>>>",
    calculation.formula,
    "<<<RESULT>>>",
    calculation.result,
    "<<<END_CALCULATION>>>",
  ]),
  ...ledger.limitations.flatMap((limitation) => [
    "<<<LIMITATION>>>",
    limitation,
    "<<<END_LIMITATION>>>",
  ]),
  "<<<END_RESEARCH>>>",
].join("\n");

/**
 * 对模型文本进行保守的确定性修复：只保留能够独立通过字段校验的完整块。
 * 缺失字段、损坏内容和未知结构不会被推断或补写。
 */
export const repairResearchProtocolLocally = (text: string) => {
  const normalized = normalize(text).replace(/^\uFEFF/, "");
  const summaryMarker = "<<<SUMMARY>>>";
  const summaryIndex = normalized.indexOf(summaryMarker);
  if (summaryIndex < 0) {
    throw new ReportTextProtocolFormatError("研究协议本地修复失败：缺少 SUMMARY 标记。");
  }

  const protocolText = normalized.slice(summaryIndex);
  const afterSummary = protocolText.slice(summaryMarker.length).replace(/^\s*\n/, "");
  const firstOuterMarker = afterSummary.search(
    /^<<<(?:FACT|CALCULATION|LIMITATION|END_RESEARCH)>>>[ \t]*$/m,
  );
  const rawSummary = firstOuterMarker >= 0
    ? afterSummary.slice(0, firstOuterMarker)
    : afterSummary;
  const summary = removeUnknownMarkerLines(rawSummary, new Set());
  if (!summary) {
    throw new ReportTextProtocolFormatError("研究协议本地修复失败：SUMMARY 正文为空。");
  }

  const originalBlockCount = countResearchBlockOpeners(afterSummary);
  const blocks = collectCompleteResearchBlocks(afterSummary);
  const facts: ResearchLedger["facts"] = [];
  const calculations: ResearchLedger["calculations"] = [];
  const limitations: string[] = [];
  let recoveredBlockCount = 0;

  for (const block of blocks) {
    try {
      if (block.kind === "fact") {
        const body = removeUnknownMarkerLines(
          block.body,
          new Set(["<<<SOURCE_TYPE>>>", "<<<SOURCE_LABEL>>>", "<<<STATEMENT>>>"]),
        );
        const [sourceType, sourceLabel, statement] = parseFixedSections(
          `${body}\n<<<END_FACT_FIELDS>>>`,
          ["<<<SOURCE_TYPE>>>", "<<<SOURCE_LABEL>>>", "<<<STATEMENT>>>"] as const,
          "<<<END_FACT_FIELDS>>>",
        );
        facts.push(validate(researchFactSchema, { sourceType, sourceLabel, statement }, "研究事实"));
      } else if (block.kind === "calculation") {
        const body = removeUnknownMarkerLines(
          block.body,
          new Set(["<<<LABEL>>>", "<<<FORMULA>>>", "<<<RESULT>>>"]),
        );
        const [label, formula, result] = parseFixedSections(
          `${body}\n<<<END_CALCULATION_FIELDS>>>`,
          ["<<<LABEL>>>", "<<<FORMULA>>>", "<<<RESULT>>>"] as const,
          "<<<END_CALCULATION_FIELDS>>>",
        );
        calculations.push(validate(
          researchCalculationSchema,
          { label, formula, result },
          "研究计算",
        ));
      } else {
        const limitation = removeUnknownMarkerLines(block.body, new Set());
        if (!limitation) {
          throw new ReportTextProtocolFormatError("研究限制正文为空。");
        }
        limitations.push(limitation);
      }
      recoveredBlockCount += 1;
    } catch (error) {
      if (!(error instanceof ReportTextProtocolFormatError)) throw error;
      // 单个损坏块由诊断计数体现；不得把部分字段拼接成新事实。
    }
  }

  if (originalBlockCount > 0 && recoveredBlockCount === 0) {
    throw new ReportTextProtocolFormatError("研究协议本地修复失败：没有可恢复的完整数据块。");
  }

  const repairedText = serializeResearchLedger({ summary, facts, calculations, limitations });
  // 修复器自身必须以严格解析结果作为最终正确性保证。
  const ledger = parseResearchLedger(repairedText);
  return {
    text: repairedText,
    ledger,
    diagnostics: {
      discardedBlockCount: Math.max(0, originalBlockCount - recoveredBlockCount),
      originalBlockCount,
      recoveredBlockCount,
    } satisfies ResearchProtocolRepairDiagnostics,
  };
};

const factSourcePriority: Record<ResearchLedger["facts"][number]["sourceType"], number> = {
  user: 4,
  lx_tool: 3,
  mock_report: 2,
  web_search: 1,
};

/** 只规范化去重键；最终保留的 statement 始终使用原始正文。 */
const createFactDeduplicationKey = (statement: string) =>
  statement
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US")
    .replace(/[。．.!！?？;；,，、]+$/gu, "");

/** 稳定去重并施加事实硬上限；高优先级来源替换内容但不改变首次出现的位置。 */
export const normalizeResearchLedgerFacts = (
  ledger: ResearchLedger,
  maxFacts = MAX_RESEARCH_FACTS,
) => {
  const deduplicated: ResearchLedger["facts"] = [];
  const factIndexes = new Map<string, number>();
  let duplicateFactCount = 0;

  for (const fact of ledger.facts) {
    const key = createFactDeduplicationKey(fact.statement);
    const existingIndex = factIndexes.get(key);
    if (existingIndex === undefined) {
      factIndexes.set(key, deduplicated.length);
      deduplicated.push(fact);
      continue;
    }

    duplicateFactCount += 1;
    const existing = deduplicated[existingIndex];
    if (factSourcePriority[fact.sourceType] > factSourcePriority[existing.sourceType]) {
      deduplicated[existingIndex] = fact;
    }
  }

  const truncatedFactCount = Math.max(0, deduplicated.length - maxFacts);
  return {
    ledger: {
      ...ledger,
      facts: deduplicated.slice(0, maxFacts),
    },
    diagnostics: {
      duplicateFactCount,
      truncatedFactCount,
    } satisfies ResearchLedgerNormalizationDiagnostics,
  };
};

export const parseReviewResult = (text: string): ReviewResult => {
  const normalized = requireText(text);
  if (!normalized.startsWith("<<<VERDICT>>>\n")) {
    throw new ReportTextProtocolFormatError("审查协议必须以 VERDICT 标记开始。");
  }
  const firstBlockMarkers = ["<<<ISSUE>>>", "<<<REPAIR>>>", endMarkers.review];
  const firstBlockIndex = firstBlockMarkers
    .map((marker) => normalized.indexOf(`\n${marker}`))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  if (firstBlockIndex === undefined) {
    throw new ReportTextProtocolFormatError("审查协议缺少结束标记。");
  }

  const verdict = normalized.slice("<<<VERDICT>>>\n".length, firstBlockIndex).trim();
  assertNoProtocolMarker(verdict, "VERDICT");
  if (verdict !== "PASS" && verdict !== "FAIL") {
    throw new ReportTextProtocolFormatError("审查结论必须是 PASS 或 FAIL。");
  }
  const blocks = parseRepeatingBlocks(
    normalized.slice(firstBlockIndex + 1),
    endMarkers.review,
    [
      { marker: "<<<ISSUE>>>", endMarker: "<<<END_ISSUE>>>" },
      { marker: "<<<REPAIR>>>", endMarker: "<<<END_REPAIR>>>" },
    ],
  );
  const issues = blocks.filter(({ marker }) => marker === "<<<ISSUE>>>").map(({ body }) => {
    assertNoProtocolMarker(body, "ISSUE");
    return body;
  });
  const repairInstructions = blocks
    .filter(({ marker }) => marker === "<<<REPAIR>>>")
    .map(({ body }) => {
      assertNoProtocolMarker(body, "REPAIR");
      return body;
    });
  return validate(reviewSchema, {
    passed: verdict === "PASS",
    issues,
    repairInstructions,
  }, "审查协议");
};

type ProtocolValidationEvent = {
  attemptNumber: number;
  formatRetry: boolean;
  diagnostics: ReportTextProtocolDiagnostics;
};

type ProtocolRetryOptions = {
  protocol: ReportTextProtocol;
  onValidationSucceeded?: (event: ProtocolValidationEvent) => void;
  onValidationFailed?: (
    event: ProtocolValidationEvent & { error: ReportTextProtocolFormatError },
  ) => void;
};

/** 普通文本协议最多生成两次；最终错误通过 cause 保留精确的本地解析原因。 */
export async function generateTextProtocolWithRetry<
  TGeneration extends { text: string },
  TParsed,
>(
  generate: (formatRetry: boolean) => Promise<TGeneration>,
  parse: (text: string) => TParsed,
  options: ProtocolRetryOptions,
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const attemptNumber = attempt + 1;
    const formatRetry = attempt === 1;
    const generation = await generate(formatRetry);
    const diagnostics = inspectReportTextProtocol(generation.text, options.protocol);
    try {
      const parsed = parse(generation.text);
      options.onValidationSucceeded?.({ attemptNumber, formatRetry, diagnostics });
      return { generation, parsed, attemptCount: attemptNumber };
    } catch (error) {
      if (!(error instanceof ReportTextProtocolFormatError)) throw error;
      options.onValidationFailed?.({ attemptNumber, formatRetry, diagnostics, error });
      if (attempt === 1) {
        throw new ReportTextProtocolFormatError(
          "模型连续两次未返回合法的报告文本协议。",
          { cause: error },
        );
      }
    }
  }
  throw new ReportTextProtocolFormatError("模型未返回合法的报告文本协议。");
}
