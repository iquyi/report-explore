import assert from "node:assert/strict";
import test from "node:test";
import { createLxEnterpriseTools } from "../tools";
import { LxEnterpriseToolsError } from "../types";

test("工具工厂只创建七个已声明工具", () => {
  const tools = createLxEnterpriseTools({ token: "test-token" });
  assert.deepEqual(Object.keys(tools), [
    "resolveEnterpriseRegion",
    "advancedCompanySearch",
    "getCompanyRegistrationInformation",
    "getCompanyShareholders",
    "getCompanyCoreMembers",
    "getCompanySubsidiaries",
    "getCompanyOutwardInvestmentList",
  ]);
  assert.equal("reportIssue" in tools, false);
});

test("工具工厂拒绝缺失 Token 和无效服务端配置", () => {
  const previousToken = process.env.LX_MCP_TOKEN;
  delete process.env.LX_MCP_TOKEN;
  try {
    assert.throws(
      () => createLxEnterpriseTools(),
      (error: unknown) =>
        error instanceof LxEnterpriseToolsError &&
        error.code === "MISSING_TOKEN",
    );
    assert.throws(
      () =>
        createLxEnterpriseTools({
          token: "test-token",
          baseUrl: "file:///private/service",
        }),
      (error: unknown) =>
        error instanceof LxEnterpriseToolsError &&
        error.code === "INVALID_BASE_URL",
    );
  } finally {
    if (previousToken === undefined) delete process.env.LX_MCP_TOKEN;
    else process.env.LX_MCP_TOKEN = previousToken;
  }
});
