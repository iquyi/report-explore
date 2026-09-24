/** 灵犀 MCP 的默认服务端配置；允许调用方覆盖，便于测试或私有化部署。 */
export const LX_ENTERPRISE_DEFAULT_BASE_URL =
  "https://agent.link-x.cn/mcp/mcp";
export const LX_ENTERPRISE_DEFAULT_TIMEOUT_MS = 120_000;
export const LX_ENTERPRISE_DEFAULT_PLATFORM = "WorkBuddy";
export const LX_ENTERPRISE_PROTOCOL_VERSION = "2024-11-05";

/**
 * 远端业务工具白名单。
 *
 * 每个业务分组还会返回 reportIssue，但迁移后的 Agent 只应拥有查询能力，
 * 因此工具工厂只依据本清单创建工具，绝不动态暴露服务端的其他工具。
 */
export const LX_ENTERPRISE_REMOTE_TOOLS = {
  advancedCompanySearch: {
    bizGroup: "adv-search",
    skillName: "lx-enterprise-precision-customer-acquisition",
    skillVersion: "1.0.2",
  },
  getCompanyRegistrationInformation: {
    bizGroup: "company-registration-info",
    skillName: "lx-enterprise-business-query",
    skillVersion: "1.0.1",
  },
  getCompanyShareholders: {
    bizGroup: "company-share-holders",
    skillName: "lx-enterprise-shareholder-query",
    skillVersion: "1.0.1",
  },
  getCompanyCoreMembers: {
    bizGroup: "company-core-members",
    skillName: "lx-enterprise-core-members-query",
    skillVersion: "1.0.1",
  },
  getCompanySubsidiaries: {
    bizGroup: "company-subsidiaries",
    skillName: "lx-enterprise-subsidiaries-query",
    skillVersion: "1.0.1",
  },
  getCompanyOutwardInvestmentList: {
    bizGroup: "company-outward-investment-list",
    skillName: "lx-enterprise-outward-investment-query",
    skillVersion: "1.0.1",
  },
} as const;

export type LxEnterpriseRemoteToolName =
  keyof typeof LX_ENTERPRISE_REMOTE_TOOLS;
export type LxEnterpriseRemoteToolConfig =
  (typeof LX_ENTERPRISE_REMOTE_TOOLS)[LxEnterpriseRemoteToolName];
