import assert from "node:assert/strict";
import test from "node:test";
import { resolveEnterpriseRegion } from "../region-resolver";

test("解析省级简称和直辖市", () => {
  assert.deepEqual(resolveEnterpriseRegion("北京"), {
    status: "unique",
    matches: [
      {
        code: "110000",
        level: 1,
        name: "北京市",
        full_path: "北京市",
        l1_code: "110000",
        l1_name: "北京市",
      },
    ],
  });
});

test("解析带上级的复合区县名称", () => {
  const result = resolveEnterpriseRegion("北京朝阳区");
  assert.equal(result.status, "unique");
  assert.equal(result.matches[0]?.code, "110105");
  assert.equal(result.matches[0]?.full_path, "北京市 / 朝阳区");
});

test("光杆同名地区返回稳定排序的歧义候选", () => {
  const result = resolveEnterpriseRegion("朝阳");
  assert.equal(result.status, "ambiguous");
  assert.deepEqual(
    result.matches.map((item) => item.code),
    ["110105", "211321", "220104", "211300"],
  );
});

test("6 位行政区代码可以直接定位", () => {
  const result = resolveEnterpriseRegion("110105");
  assert.equal(result.status, "unique");
  assert.equal(result.matches[0]?.name, "朝阳区");
});

test("未知地区返回 not_found", () => {
  assert.deepEqual(resolveEnterpriseRegion("不存在地区"), {
    status: "not_found",
    matches: [],
  });
});
