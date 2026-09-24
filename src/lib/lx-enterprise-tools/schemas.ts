import { z } from "zod";

/** 所有筛选值均来自原精准拓客 skill，调用时必须逐字传给服务端。 */
export const LX_ENTERPRISE_FILTER_OPTIONS = {
  regTimeSection: [
    "1年以内",
    "1-3年",
    "3-5年",
    "5-8年",
    "8-10年",
    "10-15年",
    "15-20年",
    "20年以上",
  ],
  regCapitalSection: [
    "100万以内",
    "100-500万",
    "500-1000万",
    "1000-5000万",
    "5000万-1亿",
    "1亿-5亿",
    "5亿以上",
  ],
  entScaleCode: [
    "大型企业",
    "中型企业",
    "小型企业",
    "微型企业",
    "其他",
    "规上企业",
    "限上企业",
  ],
  entTypeCode: ["央企", "国有企业", "港澳台企业", "外资企业", "其他"],
  listedType: ["主板", "科创板", "创业板", "新三板", "新四板", "港股", "美股"],
  financingStage: [
    "种子轮",
    "天使轮",
    "PreA至A+轮",
    "PreB至B+轮",
    "C轮及以上",
    "Pre-IPO及IPO",
    "战略投资",
    "合并/收购",
    "IPO上市",
    "新三板定增",
    "股份转让",
    "其他",
  ],
  leadCodes: [
    "全球500强",
    "中国500强",
    "中国民营500强",
    "中央企业",
    "地方大型国有企业",
    "上市企业",
    "榜单企业（头部）",
  ],
  qualityCodes: [
    "独角兽企业",
    "瞪羚企业",
    "专精特新小巨人",
    "制造业单项冠军",
    "首台套企业",
    "榜单企业（不含头部）",
    "标准定制企业",
  ],
  qualification: [
    "国高新企业",
    "中关村高新企业",
    "专精特新企业",
    "先进制造企业",
    "隐形冠军企业",
    "科技型中小企业",
    "建筑资质",
    "工业生产许可",
    "食品生产许可",
    "医药临床试验许可",
    "互联网药品信息服务许可",
    "化妆品生产许可",
    "危化品许可",
  ],
  keyAwardCodes: [
    "鲁班奖",
    "中国科学技术奖",
    "中国专利奖",
    "中国工业大奖",
    "中国优秀工业设计奖",
    "中国质量奖",
  ],
} as const;

const nonEmptyEnumArray = <T extends readonly [string, ...string[]]>(values: T) =>
  z.array(z.enum(values)).min(1);

export const positivePageSchema = z
  .number()
  .int()
  .positive()
  .describe("正整数页码；用户未指定时省略，由服务端默认使用第 1 页");

export const companyIdSchema = z
  .string()
  .trim()
  .min(1)
  .describe("内部企业 ID，只能用于工具联动，绝不能展示给最终用户");

export const regionCodeSchema = z
  .string()
  .regex(/^\d{6}$/, "地区代码必须是 6 位数字")
  .describe("resolveEnterpriseRegion 唯一命中后返回的 6 位行政区代码");

export const resolveEnterpriseRegionInputSchema = z.strictObject({
  query: z.string().trim().min(1).describe("省、市、区县、复合地区名或 6 位行政区代码"),
});

/** 精准拓客的 params 包装层与实时 MCP schema 保持一致。 */
export const advancedCompanySearchInputSchema = z.strictObject({
  params: z.strictObject({
    current: positivePageSchema.optional(),
    keyWord: z
      .string()
      .trim()
      .min(1)
      .describe("企业名称、简称、名称关键词或法定代表人姓名")
      .optional(),
    regionCode: z.array(regionCodeSchema).min(1).optional(),
    regTimeSection: nonEmptyEnumArray(
      LX_ENTERPRISE_FILTER_OPTIONS.regTimeSection,
    ).optional(),
    regCapitalSection: nonEmptyEnumArray(
      LX_ENTERPRISE_FILTER_OPTIONS.regCapitalSection,
    ).optional(),
    entScaleCode: nonEmptyEnumArray(
      LX_ENTERPRISE_FILTER_OPTIONS.entScaleCode,
    ).optional(),
    entTypeCode: nonEmptyEnumArray(
      LX_ENTERPRISE_FILTER_OPTIONS.entTypeCode,
    ).optional(),
    listedType: nonEmptyEnumArray(
      LX_ENTERPRISE_FILTER_OPTIONS.listedType,
    ).optional(),
    financingStage: nonEmptyEnumArray(
      LX_ENTERPRISE_FILTER_OPTIONS.financingStage,
    ).optional(),
    leadCodes: nonEmptyEnumArray(
      LX_ENTERPRISE_FILTER_OPTIONS.leadCodes,
    ).optional(),
    qualityCodes: nonEmptyEnumArray(
      LX_ENTERPRISE_FILTER_OPTIONS.qualityCodes,
    ).optional(),
    qualification: nonEmptyEnumArray(
      LX_ENTERPRISE_FILTER_OPTIONS.qualification,
    ).optional(),
    keyAwardCodes: nonEmptyEnumArray(
      LX_ENTERPRISE_FILTER_OPTIONS.keyAwardCodes,
    ).optional(),
  }),
});

export const companyRegistrationInputSchema = z.strictObject({
  companyId: companyIdSchema,
});

export const paginatedCompanyDetailInputSchema = z.strictObject({
  companyId: companyIdSchema,
  current: positivePageSchema.optional(),
});

export type ResolveEnterpriseRegionInput = z.infer<
  typeof resolveEnterpriseRegionInputSchema
>;
export type AdvancedCompanySearchInput = z.infer<
  typeof advancedCompanySearchInputSchema
>;
export type CompanyRegistrationInput = z.infer<
  typeof companyRegistrationInputSchema
>;
export type PaginatedCompanyDetailInput = z.infer<
  typeof paginatedCompanyDetailInputSchema
>;
