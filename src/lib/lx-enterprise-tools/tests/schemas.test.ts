import assert from "node:assert/strict";
import test from "node:test";
import {
  advancedCompanySearchInputSchema,
  companyRegistrationInputSchema,
  paginatedCompanyDetailInputSchema,
} from "../schemas";

test("精准拓客 schema 接受单次多字段、多值查询", () => {
  const parsed = advancedCompanySearchInputSchema.safeParse({
    params: {
      keyWord: "新能源",
      regionCode: ["110105", "310000"],
      entScaleCode: ["大型企业", "中型企业"],
      listedType: ["主板", "科创板"],
      current: 2,
    },
  });
  assert.equal(parsed.success, true);
});

test("精准拓客 schema 拒绝非法枚举、空数组和非法地区码", () => {
  assert.equal(
    advancedCompanySearchInputSchema.safeParse({
      params: { entScaleCode: ["超大型企业"] },
    }).success,
    false,
  );
  assert.equal(
    advancedCompanySearchInputSchema.safeParse({
      params: { entScaleCode: [] },
    }).success,
    false,
  );
  assert.equal(
    advancedCompanySearchInputSchema.safeParse({
      params: { regionCode: ["北京"] },
    }).success,
    false,
  );
});

test("详情 schema 拒绝空企业 ID 和非正页码", () => {
  assert.equal(
    companyRegistrationInputSchema.safeParse({ companyId: "  " }).success,
    false,
  );
  assert.equal(
    paginatedCompanyDetailInputSchema.safeParse({
      companyId: "company-internal-id",
      current: 0,
    }).success,
    false,
  );
  assert.equal(
    paginatedCompanyDetailInputSchema.safeParse({
      companyId: "company-internal-id",
      current: 1,
    }).success,
    true,
  );
});
