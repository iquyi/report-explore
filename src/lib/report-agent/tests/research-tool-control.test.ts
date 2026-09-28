import assert from "node:assert/strict";
import test from "node:test";
import { tool } from "ai";
import { z } from "zod";
import { createResearchToolController } from "../research-tool-control";

const executionOptions = {
  toolCallId: "test-call",
  messages: [],
  context: undefined,
};

test("并发等价联网查询共享请求且不同查询不受次数限制", async () => {
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

  // 超过历史八次上限，确认每个不同查询都会继续访问后端。
  for (let index = 1; index <= 9; index += 1) {
    await tools.tavilySearch.execute({ query: `不同查询 ${index}` }, executionOptions);
  }

  assert.equal(executionCount, 10);
  assert.deepEqual(controller.getStats(), {
    cacheHitCount: 1,
    webSearchExecutionCount: 10,
    advancedCompanySearchExecutionCount: 0,
  });
});

test("企业精准搜索不受次数限制且所有工具按规范化参数缓存", async () => {
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
  const secondCompany = await tools.advancedCompanySearch.execute(
    { keyWord: "另一企业" },
    executionOptions,
  );
  await tools.getCompanyRegistrationInformation.execute(
    { companyId: " company-1 " },
    executionOptions,
  );
  await tools.getCompanyRegistrationInformation.execute(
    { companyId: "company-1" },
    executionOptions,
  );

  assert.equal(advancedExecutionCount, 2);
  assert.equal(detailExecutionCount, 1);
  assert.deepEqual(secondCompany, { keyWord: "另一企业" });
  assert.deepEqual(controller.getStats(), {
    cacheHitCount: 2,
    webSearchExecutionCount: 0,
    advancedCompanySearchExecutionCount: 2,
  });
});
