import assert from "node:assert/strict";
import test from "node:test";
import { tool } from "ai";
import { z } from "zod";
import {
  createResearchToolController,
  MAX_REPORT_WEB_SEARCHES,
} from "../research-tool-control";

const executionOptions = {
  toolCallId: "test-call",
  messages: [],
  context: undefined,
};

test("并发等价联网查询共享请求且第九个不同查询不访问后端", async () => {
  let executionCount = 0;
  const controller = createResearchToolController();
  const tools = controller.wrapTools({
    tavilySearch: tool({
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        executionCount += 1;
        return { query, results: [{ title: query }] };
      },
    }),
  });

  const [first, duplicate] = await Promise.all([
    tools.tavilySearch.execute({ query: "  ＡＩ 产业 " }, executionOptions),
    tools.tavilySearch.execute({ query: "ai 产业" }, executionOptions),
  ]);
  assert.deepEqual(duplicate, first);
  assert.equal(executionCount, 1);

  for (let index = 1; index < MAX_REPORT_WEB_SEARCHES; index += 1) {
    await tools.tavilySearch.execute({ query: `不同查询 ${index}` }, executionOptions);
  }
  const limited = await tools.tavilySearch.execute(
    { query: "超过上限的查询" },
    executionOptions,
  ) as unknown as { limitReached: boolean; results: unknown[] };

  assert.equal(executionCount, MAX_REPORT_WEB_SEARCHES);
  assert.equal(limited.limitReached, true);
  assert.deepEqual(limited.results, []);
  assert.deepEqual(controller.getStats(), {
    cacheHitCount: 1,
    webSearchExecutionCount: MAX_REPORT_WEB_SEARCHES,
    webSearchLimitHitCount: 1,
    advancedCompanySearchExecutionCount: 0,
    advancedCompanySearchLimitHitCount: 0,
  });
});

test("企业精准搜索最多执行一次且其他工具按规范化参数缓存", async () => {
  let advancedExecutionCount = 0;
  let detailExecutionCount = 0;
  const controller = createResearchToolController();
  const tools = controller.wrapTools({
    advancedCompanySearch: tool({
      inputSchema: z.object({ keyWord: z.string() }),
      execute: async (input) => {
        advancedExecutionCount += 1;
        return input;
      },
    }),
    getCompanyRegistrationInformation: tool({
      inputSchema: z.object({ companyId: z.string() }),
      execute: async (input) => {
        detailExecutionCount += 1;
        return input;
      },
    }),
  });

  await tools.advancedCompanySearch.execute({ keyWord: "  测试企业 " }, executionOptions);
  await tools.advancedCompanySearch.execute({ keyWord: "测试企业" }, executionOptions);
  const limited = await tools.advancedCompanySearch.execute(
    { keyWord: "另一企业" },
    executionOptions,
  ) as unknown as { limitReached: boolean };
  await tools.getCompanyRegistrationInformation.execute(
    { companyId: " company-1 " },
    executionOptions,
  );
  await tools.getCompanyRegistrationInformation.execute(
    { companyId: "company-1" },
    executionOptions,
  );

  assert.equal(advancedExecutionCount, 1);
  assert.equal(detailExecutionCount, 1);
  assert.equal(limited.limitReached, true);
  assert.deepEqual(controller.getStats(), {
    cacheHitCount: 2,
    webSearchExecutionCount: 0,
    webSearchLimitHitCount: 0,
    advancedCompanySearchExecutionCount: 1,
    advancedCompanySearchLimitHitCount: 1,
  });
});
