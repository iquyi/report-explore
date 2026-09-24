# 灵犀企业数据 AI SDK 工具

本目录把 `skill/` 中现有的 6 个 WorkBuddy skill 整理为 Vercel AI SDK 7 可直接使用的类型安全工具。它只提供工具、规则和纯函数，不创建具体 Agent，也不会读取或修改原 skill 文件。

## 能力

- 企业精准拓客与企业定位
- 企业工商信息
- 企业股东信息
- 企业主要成员
- 企业分支机构
- 企业对外投资
- 本地行政区名称解析

工具工厂只暴露上述查询能力。远端 MCP 同时返回的 `reportIssue` 不在白名单内，Agent 无法调用它。

## 服务端配置

在 `.env.local` 或部署平台的服务端环境变量中配置：

```dotenv
LX_MCP_TOKEN=你的灵犀Token
```

也可以在创建工具时显式传入 `token`。显式参数优先于环境变量；工具不会读取 `~/.lx_skills_auth/config.json`，也不会在磁盘写入 Token。

这些工具必须在 Node.js 服务端使用，不要从 Client Component 导入，否则可能把凭据暴露给浏览器。

## 接入 ToolLoopAgent

```ts
import { deepSeek } from "@ai-sdk/deepseek";
import { ToolLoopAgent } from "ai";
import {
  createLxEnterpriseTools,
  LX_ENTERPRISE_AGENT_INSTRUCTIONS,
} from "@/lib/lx-enterprise-tools";

const tools = createLxEnterpriseTools();

const agent = new ToolLoopAgent({
  model: deepSeek(process.env.DEEPSEEK_MODEL ?? "deepseek-flash"),
  instructions: LX_ENTERPRISE_AGENT_INSTRUCTIONS,
  tools,
});
```

也可以把同一组 `tools` 与指令传给 `generateText` 或 `streamText`。如果应用已有 system instructions，应把 `LX_ENTERPRISE_AGENT_INSTRUCTIONS` 作为独立规则段拼接，而不是放入用户消息。

## 工具工厂选项

```ts
const tools = createLxEnterpriseTools({
  token: process.env.LX_MCP_TOKEN,
  baseUrl: "https://agent.link-x.cn/mcp/mcp",
  timeoutMs: 120_000,
  platform: "WorkBuddy",
  fetch: globalThis.fetch,
});
```

- `token`：可省略，缺省读取 `process.env.LX_MCP_TOKEN`。
- `baseUrl`：可选 MCP 地址，必须是 HTTP/HTTPS。
- `timeoutMs`：一次完整 MCP 会话的总超时，默认 120 秒。
- `platform`：请求头平台标识，默认沿用原 skill 的 `WorkBuddy`。
- `fetch`：可注入自定义网络实现，便于测试、审计或设置网络代理。

缺少 Token 或配置无效时，`createLxEnterpriseTools` 会同步抛出 `LxEnterpriseToolsError`。错误文本不会包含 Token、请求头或端点。

## 工具结果

工具执行结果统一返回：

```ts
type LxEnterpriseToolOutput =
  | { format: "json"; payload: unknown }
  | { format: "text"; payload: string };
```

JSON 业务响应会保留在 `payload` 中，不截断、不改写字段值。搜索结果中的 `companyId` 也会保留，供 Agent 调用详情工具，但统一指令严格禁止在最终回答中展示它。

## 地区与筛选条件

`resolveEnterpriseRegion` 同时作为工具和纯函数导出：

```ts
import { resolveEnterpriseRegion } from "@/lib/lx-enterprise-tools";

resolveEnterpriseRegion("北京朝阳区");
// { status: "unique", matches: [{ code: "110105", ... }] }
```

返回状态：

- `unique`：可以把唯一候选的 `code` 传给 `advancedCompanySearch.params.regionCode`。
- `ambiguous`：应向用户展示 `full_path` 候选并等待确认。
- `not_found`：应请用户提供更准确的地区名称。

全部高级筛选合法值通过 `LX_ENTERPRISE_FILTER_OPTIONS` 导出，并已写入 Zod schema。非法枚举、空数组、非正页码、空企业 ID 和非 6 位地区码都会在调用前被 AI SDK 拒绝。

## 单独使用规则

如果调用方只装配部分工具，可以从 `LX_ENTERPRISE_TOOL_INSTRUCTIONS` 或对应的分项常量中选择规则。例如，只接入企业搜索时使用 `common` 与 `search`，避免为模型注入无关工具说明。
