import assert from "node:assert/strict";
import test from "node:test";
import { ReportArtifactStore } from "../artifact-store";

test("Artifact Store 只允许按正确 ID 与类型读取", () => {
  const store = new ReportArtifactStore();
  const id = store.put("html", {
    title: "报告",
    markdown: "```html\n<!doctype html><html><body>报告</body></html>\n```",
    html: "<!doctype html><html><body>报告</body></html>",
    revision: "draft",
  });

  assert.equal(store.get(id, "html").title, "报告");
  assert.throws(() => store.get(id, "research"), /无效的 research artifact ID/);
  assert.throws(() => store.get("forged", "html"), /无效的 html artifact ID/);
});

test("Artifact Store 保存单次工作流选中的设计风格", () => {
  const store = new ReportArtifactStore();
  const id = store.put("style", {
    id: "10000000-0000-4000-8000-000000000001",
    name: "蓝色科技编辑风格",
    description: "默认风格",
    promptRules: "视觉规则",
    isDefault: true,
  });

  assert.equal(store.get(id, "style").promptRules, "视觉规则");
  assert.throws(() => store.get(id, "template"), /无效的 template artifact ID/);
});
