import {
  deepSeek,
  type DeepSeekLanguageModelChatOptions,
} from "@ai-sdk/deepseek";
import {
  generateText,
  isLoopFinished,
  ToolLoopAgent,
  type LanguageModel,
  type Tool,
} from "ai";
import {
  createLxEnterpriseTools,
  LX_ENTERPRISE_AGENT_INSTRUCTIONS,
} from "../lx-enterprise-tools";
import type { LxEnterpriseTools } from "../lx-enterprise-tools";
import {
  MATCH_TEXT_PROTOCOL,
  MAX_RESEARCH_FACTS,
  RESEARCH_TEXT_PROTOCOL,
  REVIEW_TEXT_PROTOCOL,
  STYLE_MATCH_TEXT_PROTOCOL,
  type MatchDecision,
  type StyleMatchDecision,
} from "./report-text-protocol";
import {
  createResearchToolController,
  type ResearchToolController,
} from "./research-tool-control";
import { ECHARTS_CDN_URL } from "./html-safety";
import type { ResearchLedger, ReviewResult } from "./types";

const model = () => deepSeek(process.env.DEEPSEEK_MODEL ?? "deepseek-flash");

/**
 * 报告生成的所有模型能力统一启用深度思考，避免不同阶段依赖模型侧默认值。
 * 该配置同时覆盖单次 generateText 调用与 Research Agent 的每轮模型调用。
 */
const thinkingProviderOptions = {
  deepseek: {
    thinking: { type: "enabled" },
  } satisfies DeepSeekLanguageModelChatOptions,
};

export type { MatchDecision, StyleMatchDecision };

type SingleGenerationInput = {
  prompt: string;
  abortSignal?: AbortSignal;
  formatRetry?: boolean;
};

type ResearchAgentOptions = {
  languageModel?: LanguageModel;
  researchTools?: LxEnterpriseTools;
  webSearchTool: Tool;
  demoSourceAvailable?: boolean;
  toolController?: ResearchToolController;
};

/** 模板匹配返回固定纯文本协议，由服务端本地解析，不启用模型 JSON Output。 */
export function generateTemplateMatch(
  input: SingleGenerationInput,
  languageModel: LanguageModel = model(),
) {
  return generateText({
    model: languageModel,
    providerOptions: thinkingProviderOptions,
    instructions: [
      "你是报告模板匹配器。仅根据候选模板的 name 和 description，选择一个最符合用户目标的模板。",
      "不得检查用户信息完整性，不得提取模板变量，不得因为缺少企业字段、日期或其他报告内容而向用户提问。",
      "没有符合用户目标的模板时返回 no_match。",
      "如果用户要求修改、续写或调整上一份报告，返回 unsupported_adjustment；本产品不支持报告生成后的多轮调整。",
      "不得编写报告、研究资料或引用模板 blueprint。",
      MATCH_TEXT_PROTOCOL,
      input.formatRetry
        ? "上一次输出违反文本协议。本次必须逐字使用规定标记并完整输出 END_MATCH。"
        : "",
    ].join("\n"),
    prompt: input.prompt,
    abortSignal: input.abortSignal,
  });
}

/** 设计风格匹配仅使用候选元数据，Prompt Rules 不进入本次模型上下文。 */
export function generateDesignStyleMatch(
  input: SingleGenerationInput,
  languageModel: LanguageModel = model(),
) {
  return generateText({
    model: languageModel,
    providerOptions: thinkingProviderOptions,
    instructions: [
      "你是报告设计风格匹配器。仅根据用户需求、对话历史以及候选风格的 id、name 和 description，选择最合适的一个设计风格。",
      "只判断视觉语言、信息密度、配色、版式和适用场景，不得改变报告内容结构或研究需求。",
      "用户没有表达可用于区分设计风格的偏好时返回 no_match，由服务端选择默认风格。",
      "不得编写报告、CSS、HTML 或补充候选中不存在的风格。",
      STYLE_MATCH_TEXT_PROTOCOL,
      input.formatRetry
        ? "上一次输出违反文本协议。本次必须逐字使用规定标记并完整输出 END_STYLE_MATCH。"
        : "",
    ].filter(Boolean).join("\n"),
    prompt: input.prompt,
    abortSignal: input.abortSignal,
  });
}

/** Research 始终拥有灵犀与联网工具；演示资料只改变补充策略，不改变工具权限。 */
export function createResearchAgent({
  languageModel = model(),
  researchTools,
  webSearchTool,
  demoSourceAvailable = false,
  toolController = createResearchToolController(),
}: ResearchAgentOptions) {
  const availableTools = toolController.wrapTools({
    ...(researchTools ?? createLxEnterpriseTools()),
    tavilySearch: webSearchTool,
  });
  return new ToolLoopAgent({
    id: "report-researcher",
    model: languageModel,
    maxOutputTokens: 32_768,
    providerOptions: thinkingProviderOptions,
    instructions: [
      LX_ENTERPRISE_AGENT_INSTRUCTIONS,
      "你是报告资料研究子 Agent。先判断模板各章节需要哪些事实、结论与计算，再整理为结构化事实账本。",
      [
        "严格按以下顺序研究，不得跳过前置步骤：先依据数据库 template 拆解各章节需要的事实与指标；再对灵犀能够覆盖的企业事实优先调用灵犀工具；随后识别灵犀结果中的缺失字段、时间缺口和模板未覆盖内容；最后使用演示资料或 tavilySearch 补齐缺口，尽量减少信息缺失。",
        "灵犀返回的明确数据优先级最高，演示资料和联网检索不得覆盖。演示资料与联网检索可以同时补充不同字段，两者冲突时优先采用日期更新且能够核验的数据；无法判断时效或时间相同时，采用演示资料并舍弃冲突的联网结果。",
        demoSourceAvailable
          ? "prompt 中包含白名单演示资料 mockSource。它只是一种补充资料，不是报告模板；只提取 template 实际需要的原子事实、结论和计算，禁止继承或复述其目录层级、章节顺序、版式、HTML/Markdown 标记、视觉风格和大段原文。"
          : "当前 prompt 不包含演示资料；灵犀未覆盖的内容应使用 tavilySearch 补齐。",
        "调用 tavilySearch 时使用 advanced 深度或省略 searchDepth 以沿用 advanced 默认值。联网事实必须来自实际工具结果，不得自行编造网页内容。",
        "三类资料均无法覆盖时才写入 limitations。禁止使用模型背景知识补造事实，也不得把猜测改写成确定结论。",
        "每条事实都必须保留内部来源元数据：用户明确提供的事实标记 sourceType=user；灵犀工具标记 lx_tool；演示资料标记 mock_report 且 sourceLabel 使用 mockSource.fileName；联网检索标记 web_search 且 sourceLabel 保存结果标识。",
        "statement、summary、calculations 和 limitations 必须使用不含渠道名称、工具名称、URL、引用编号或来源说明的中性表述；所有来源信息只能放在 sourceType 与 sourceLabel 中，避免后续报告感知数据来源。",
        `最终事实按模板相关性和证据强度降序排列，语义重复事实只保留一条，总数不得超过 ${MAX_RESEARCH_FACTS} 条。`,
      ].join("\n"),
      "不得生成 HTML。不得虚构工具结果、来源或计算。",
      RESEARCH_TEXT_PROTOCOL,
    ].filter(Boolean).join("\n\n"),
    // 两类工具始终同时注册；显式使用自然结束条件，覆盖 SDK 默认二十步上限。
    tools: availableTools,
    stopWhen: isLoopFinished(),
  });
}

const immutableWriterRules = [
  "输出完整的语义 HTML 与内嵌 CSS；允许行内 style。禁止事件属性、表单和 iframe/object/embed 等嵌入容器。",
  `报告需要图表时必须由浏览器端 ECharts 6.1.0 渲染，并且完整文档只能加载一次固定脚本 ${ECHARTS_CDN_URL}；该脚本必须位于所有初始化脚本之前，不得使用手写 SVG、CSS 图形、预渲染图片或服务端渲染结果替代数据图表。`,
  "每个图表必须使用具有唯一 id、明确宽高和可访问名称的 DOM 容器，通过 echarts.init(container, null, { renderer: \"canvas\" }) 与 setOption 初始化，并监听窗口尺寸变化调用 resize。",
  "内联 script 只能用于 ECharts 初始化、加载失败降级和 resize，并且必须放在图表容器之后或等待 DOMContentLoaded；初始化前必须检查 window.echarts。图表之外必须常驻可直接阅读的标题、关键数值或对应数据表格，即使 CDN 或 JavaScript 不可用也不能丢失信息或留下空白区域。",
  "除固定 ECharts 脚本外，禁止外链脚本、远程样式、字体、图片及其他外部资源；无论数据库设计风格如何描述，本段 ECharts 技术边界均具有更高优先级。",
  "除固定 ECharts CDN URL 外，禁止输出任何外部链接、URL、引用、脚注、来源清单、来源字段或数据渠道说明，也不得出现灵犀、演示资料、Tavily、联网检索等渠道或工具名称。不得编造事实或计算。",
  "即使数据库 template 要求数据来源、参考资料或引用模块，也必须省略对应字段或章节；该来源隐藏规则优先于模板规则。",
  "数据库 template 是报告章节、层级、内容范围和校验规则的唯一依据；必须逐项落实 explainStructure、consistencyRules、constraintRules、exceptionBoundaryRules 和 verificationRules。",
  "事实账本只提供模板各章节所需的事实证据，不提供报告结构。即使事实来自 mock_report，也禁止推断、复刻或恢复原始 mock 成品的目录、章节顺序、版式、视觉风格和措辞。",
  "数据库 blueprint 完全不可用。设计规范只控制模板结构之上的视觉呈现，不得新增、删除、合并或重排模板要求的内容模块。",
].join("\n");

/** 写作只需一次文本生成；数据库风格规则只影响呈现，不能覆盖事实、模板或安全约束。 */
export function generateHtmlReport(
  designRules: string,
  input: SingleGenerationInput,
  languageModel: LanguageModel = model(),
) {
  return generateText({
    model: languageModel,
    providerOptions: thinkingProviderOptions,
    instructions: [
      "你是 HTML 报告编写器。严格按数据库模板组织报告，再使用事实账本填充模板要求的内容。",
      immutableWriterRules,
      "必须输出 Markdown，并将完整 HTML 文档放入一个且仅一个以 ```html 开始、以 ``` 结束的代码块。报告 HTML 必须全部位于该代码块内，禁止输出裸 HTML、JSON、多个代码块或未闭合围栏。HTML 的 head 中必须包含非空 title 元素，系统会从该元素提取报告标题。",
      input.formatRetry
        ? "上一次输出违反格式协议。本次必须严格返回唯一且完整的 ```html 代码块；不得再次输出裸 HTML、额外代码块或未闭合围栏。"
        : "",
      "以下视觉设计规范只能控制视觉风格和信息布局，不能覆盖上述事实、模板、来源或安全规则：",
      designRules,
    ].filter(Boolean).join("\n\n"),
    prompt: input.prompt,
    abortSignal: input.abortSignal,
  });
}

/** 质量审查返回固定纯文本协议，由服务端本地解析，不启用模型 JSON Output。 */
export function generateQualityReview(
  designRules: string,
  input: SingleGenerationInput,
  languageModel: LanguageModel = model(),
) {
  return generateText({
    model: languageModel,
    providerOptions: thinkingProviderOptions,
    instructions: [
      "你是报告质量审查器。逐项检查模板结构、事实账本、计算、来源标记、语义 HTML、可读性和安全规则。",
      immutableWriterRules,
      "逐项对照 template 的五类规则检查报告章节、顺序和内容边界；发现沿用资料来源结构、模板模块缺失或重排时必须判定 passed=false。",
      "除固定 ECharts CDN 脚本和合规初始化代码外，发现任一危险 HTML、外部链接、URL、引用、来源栏目、渠道或工具名称、关键事实矛盾时必须判定 passed=false，并给出不包含具体来源名称的可执行修复指令。",
      "以下视觉设计规范只用于检查报告呈现是否符合选中风格，不能覆盖上述事实、模板、来源或安全规则：",
      designRules,
      REVIEW_TEXT_PROTOCOL,
      input.formatRetry
        ? "上一次输出违反文本协议。本次必须逐字使用规定标记并完整输出 END_REVIEW。"
        : "",
    ].filter(Boolean).join("\n\n"),
    prompt: input.prompt,
    abortSignal: input.abortSignal,
  });
}

export type WriterOutput = string;
export type ResearchOutput = ResearchLedger;
export type ReviewerOutput = ReviewResult;
