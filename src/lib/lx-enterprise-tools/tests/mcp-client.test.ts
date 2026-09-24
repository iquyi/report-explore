import assert from "node:assert/strict";
import test from "node:test";
import { LX_ENTERPRISE_REMOTE_TOOLS } from "../constants";
import { callLxMcpTool } from "../mcp-client";
import { LxEnterpriseToolsError } from "../types";

type CapturedRequest = {
  headers: Headers;
  body: Record<string, unknown>;
};

const createSequenceFetch = (
  responses: Response[],
  captured: CapturedRequest[] = [],
) =>
  (async (_input, init) => {
    captured.push({
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const response = responses.shift();
    if (!response) throw new Error("测试响应队列已耗尽");
    return response;
  }) as typeof fetch;

const callOptions = {
  baseUrl: "https://example.invalid/mcp",
  token: "secret-token-for-test",
  timeoutMs: 1_000,
  platform: "WorkBuddy",
  toolName: "advancedCompanySearch" as const,
  toolConfig: LX_ENTERPRISE_REMOTE_TOOLS.advancedCompanySearch,
  arguments: { params: { keyWord: "新能源" } },
};

test("完成 initialize、initialized 和 tools/call，并解析 SSE JSON 文本", async () => {
  const captured: CapturedRequest[] = [];
  const fetch = createSequenceFetch(
    [
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { protocolVersion: "2024-11-05" },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "mcp-session-id": "session-1",
          },
        },
      ),
      new Response("", { status: 202 }),
      new Response(
        `data: ${JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: true,
                  data: { companyId: "internal-company-id" },
                }),
              },
            ],
          },
        })}\n\n`,
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    ],
    captured,
  );

  const result = await callLxMcpTool({ ...callOptions, fetch });
  assert.deepEqual(result, {
    format: "json",
    payload: { success: true, data: { companyId: "internal-company-id" } },
  });
  assert.deepEqual(
    captured.map((item) => item.body.method),
    ["initialize", "notifications/initialized", "tools/call"],
  );
  assert.equal(captured[0]?.headers.get("x-mcp-biz-group"), "adv-search");
  assert.equal(captured[0]?.headers.get("client-version"), "1.0.2");
  assert.equal(captured[1]?.headers.get("client-version"), "1.0.2");
  assert.equal(captured[2]?.headers.get("client-version"), "1.0.2");
  assert.equal(captured[1]?.headers.get("mcp-session-id"), "session-1");
  assert.equal(captured[2]?.headers.get("mcp-session-id"), "session-1");
  assert.equal(
    JSON.stringify(result).includes("secret-token-for-test"),
    false,
  );
  assert.equal(JSON.stringify(result).includes(callOptions.baseUrl), false);
});

test("JSON structuredContent 优先作为结构化结果返回", async () => {
  const fetch = createSequenceFetch([
    new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: { structuredContent: { success: true, data: { total: 1 } } },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  ]);

  const result = await callLxMcpTool({ ...callOptions, fetch });
  assert.deepEqual(result, {
    format: "json",
    payload: { success: true, data: { total: 1 } },
  });
});

test("认证和端点错误只返回安全提示", async () => {
  for (const [status, expectedCode] of [
    [401, "AUTH_FAILED"],
    [404, "ENDPOINT_NOT_FOUND"],
  ] as const) {
    const fetch = createSequenceFetch([new Response("private body", { status })]);
    await assert.rejects(
      callLxMcpTool({ ...callOptions, fetch }),
      (error: unknown) => {
        assert.ok(error instanceof LxEnterpriseToolsError);
        assert.equal(error.code, expectedCode);
        assert.equal(error.message.includes("secret-token-for-test"), false);
        assert.equal(error.message.includes(callOptions.baseUrl), false);
        assert.equal(error.message.includes("private body"), false);
        return true;
      },
    );
  }
});

test("JSON-RPC 错误不会透传远端内部消息", async () => {
  const fetch = createSequenceFetch([
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "internal endpoint and stack" },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  ]);

  await assert.rejects(
    callLxMcpTool({ ...callOptions, fetch }),
    (error: unknown) => {
      assert.ok(error instanceof LxEnterpriseToolsError);
      assert.equal(error.code, "JSON_RPC_ERROR");
      assert.equal(error.message.includes("internal endpoint and stack"), false);
      return true;
    },
  );
});

test("JSON-RPC 请求头错误转换为安全且可定位的错误码", async () => {
  for (const [message, expectedCode] of [
    ["请求头缺失 client-version", "CLIENT_VERSION_REQUIRED"],
    ["请求头缺失 X-Mcp-Token", "AUTH_FAILED"],
    ["请求头缺失 private-internal-header", "REQUEST_HEADER_INVALID"],
  ] as const) {
    const fetch = createSequenceFetch([
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32001, message },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ]);

    await assert.rejects(
      callLxMcpTool({ ...callOptions, fetch }),
      (error: unknown) => {
        assert.ok(error instanceof LxEnterpriseToolsError);
        assert.equal(error.code, expectedCode);
        assert.equal(error.message.includes("private-internal-header"), false);
        return true;
      },
    );
  }
});

test("总超时和调用方中止被区分", async () => {
  const abortingFetch = (async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const rejectAbort = () =>
        reject(new DOMException("aborted", "AbortError"));
      if (init?.signal?.aborted) rejectAbort();
      else init?.signal?.addEventListener("abort", rejectAbort, { once: true });
    })) as typeof fetch;

  await assert.rejects(
    callLxMcpTool({
      ...callOptions,
      fetch: abortingFetch,
      timeoutMs: 5,
    }),
    (error: unknown) =>
      error instanceof LxEnterpriseToolsError && error.code === "TIMEOUT",
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    callLxMcpTool({
      ...callOptions,
      fetch: abortingFetch,
      abortSignal: controller.signal,
    }),
    (error: unknown) =>
      error instanceof LxEnterpriseToolsError && error.code === "ABORTED",
  );
});
