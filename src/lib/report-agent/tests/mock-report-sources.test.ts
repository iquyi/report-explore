import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_REPORT_PROMPTS } from "../../report-demo";
import {
  decodeMockReportContent,
  getMockReportSourceDefinition,
  getResearchStageLabel,
  loadMockReportSource,
} from "../mock-report-sources";

const expectedFiles = [
  "定兴县食品加工产业招商评估报告.html",
  "北京市人工智能产业诊断报告.md",
  "月之暗面企业画像报告.md",
];

test("三条固定指令一一映射并可读取有效 UTF-8 成品", async () => {
  for (const [index, prompt] of DEMO_REPORT_PROMPTS.entries()) {
    const definition = getMockReportSourceDefinition(`  ${prompt}  `);
    const source = await loadMockReportSource(`  ${prompt}  `);

    assert.equal(definition?.fileName, expectedFiles[index]);
    assert.equal(source?.fileName, expectedFiles[index]);
    assert.ok(source && source.content.length > 1_000);
    assert.doesNotMatch(source.content, /\uFFFD/);
  }
});

test("演示与普通请求使用相同的中性研究状态文案", async () => {
  const request = "生成其他企业报告";
  assert.equal(getMockReportSourceDefinition(request), null);
  assert.equal(await loadMockReportSource(request), null);
  assert.equal(getResearchStageLabel(request), "正在研究报告所需资料…");
  assert.equal(
    getResearchStageLabel(DEMO_REPORT_PROMPTS[0]),
    "正在研究报告所需资料…",
  );
});

test("严格拒绝非法 UTF-8 与已写入的替换字符", () => {
  assert.throws(
    () => decodeMockReportContent(Uint8Array.from([0xc3, 0x28]), "损坏.md"),
    TypeError,
  );
  assert.throws(
    () =>
      decodeMockReportContent(
        new TextEncoder().encode("错误\uFFFD内容"),
        "损坏.md",
      ),
    /包含无效替换字符/,
  );
});
