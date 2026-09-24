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
