/** 三条固定演示需求由服务端白名单与聊天快捷入口共同复用，避免文本漂移。 */
export const DEMO_REPORT_PROMPTS = [
  "为定兴县招商投资促进服务中心生成一份针对食品加工产业的招商线索分析报告",
  "生成北京市人工智能产业诊断报告",
  "生成月之暗面企业画像报告",
] as const;

export type DemoReportPrompt = (typeof DEMO_REPORT_PROMPTS)[number];
