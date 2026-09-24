import regionDataJson from "./data/region-code.json";
import type { RegionLevel, RegionMatch, RegionResolution } from "./types";

type RegionSourceNode = {
  code: string;
  name: string;
  children?: RegionSourceNode[];
};

type RegionNode = {
  code: string;
  name: string;
  level: RegionLevel;
  parentCode: string | null;
  normalizedName: string;
  provinceCode: string;
  provinceName: string;
  cityName: string;
  /** 近到远排列的祖先原名与归一化名称，用于解析“北京朝阳区”等复合输入。 */
  ancestors: Array<readonly [fullName: string, normalizedName: string]>;
};

const regionData = regionDataJson as RegionSourceNode[];

/** 省级常用口语别名；非单一省份的简称不会放入映射。 */
const PROVINCE_ALIASES: Readonly<Record<string, string>> = {
  内蒙: "内蒙古自治区",
  内蒙古: "内蒙古自治区",
  广西: "广西壮族自治区",
  宁夏: "宁夏回族自治区",
  新疆: "新疆维吾尔自治区",
  西藏: "西藏自治区",
  香港: "香港特别行政区",
  澳门: "澳门特别行政区",
  黑: "黑龙江省",
  黑龙江: "黑龙江省",
  北京: "北京市",
  上海: "上海市",
  天津: "天津市",
  重庆: "重庆市",
};

/** 长后缀优先，防止“维吾尔自治区”被先按“自治区”处理。 */
const REGION_SUFFIXES = [
  "维吾尔自治区",
  "壮族自治区",
  "回族自治区",
  "特别行政区",
  "自治区",
  "自治州",
  "自治县",
  "地区",
  "盟",
  "省",
  "市",
  "区",
  "县",
  "旗",
] as const;

const PLACEHOLDER_CITY_NAMES = new Set(["市辖区", "县"]);
const DIRECT_MUNICIPALITY_CODES = new Set([
  "110000",
  "120000",
  "310000",
  "500000",
]);

const stripRegionSuffix = (name: string): string => {
  for (const suffix of REGION_SUFFIXES) {
    if (name.endsWith(suffix) && name.length > suffix.length) {
      return name.slice(0, -suffix.length);
    }
  }
  return name;
};

const isPlaceholderCity = (node: RegionNode): boolean =>
  node.level === 2 &&
  (PLACEHOLDER_CITY_NAMES.has(node.name) ||
    (DIRECT_MUNICIPALITY_CODES.has(node.provinceCode) &&
      node.name === node.provinceName));

const addToIndex = (
  index: Map<string, RegionNode[]>,
  key: string,
  node: RegionNode,
) => {
  const existing = index.get(key);
  if (existing) existing.push(node);
  else index.set(key, [node]);
};

/**
 * 全国行政区索引只在进程内构建一次。
 * 精确名和去后缀名称分别索引，避免“朝阳区”被“朝阳市/朝阳县”污染。
 */
class RegionIndex {
  private readonly nodes = new Map<string, RegionNode>();
  private readonly byName = new Map<string, RegionNode[]>();
  private readonly byNormalizedName = new Map<string, RegionNode[]>();

  constructor(source: RegionSourceNode[]) {
    for (const province of source) {
      const provinceNode = this.addNode({
        code: province.code,
        name: province.name,
        level: 1,
        parentCode: null,
        provinceCode: province.code,
        provinceName: province.name,
        cityName: "",
      });

      for (const city of province.children ?? []) {
        const cityNode = this.addNode({
          code: city.code,
          name: city.name,
          level: 2,
          parentCode: provinceNode.code,
          provinceCode: provinceNode.code,
          provinceName: provinceNode.name,
          cityName: city.name,
        });

        for (const area of city.children ?? []) {
          this.addNode({
            code: area.code,
            name: area.name,
            level: 3,
            parentCode: cityNode.code,
            provinceCode: provinceNode.code,
            provinceName: provinceNode.name,
            cityName: cityNode.name,
          });
        }
      }
    }
  }

  private addNode(input: Omit<RegionNode, "normalizedName" | "ancestors">) {
    const ancestors: RegionNode["ancestors"] = [];
    let parentCode = input.parentCode;

    // 祖先按近到远保存；直辖市占位层只参与路径构建，不参与名称匹配。
    while (parentCode) {
      const parent = this.nodes.get(parentCode);
      if (!parent) break;
      if (!isPlaceholderCity(parent)) {
        ancestors.push([parent.name, parent.normalizedName]);
      }
      parentCode = parent.parentCode;
    }

    const node: RegionNode = {
      ...input,
      normalizedName: stripRegionSuffix(input.name),
      ancestors,
    };
    this.nodes.set(node.code, node);

    // “市辖区”等节点只承载层级关系，不作为用户可搜索的独立地区。
    if (!isPlaceholderCity(node)) {
      addToIndex(this.byName, node.name, node);
      if (node.normalizedName !== node.name) {
        addToIndex(this.byNormalizedName, node.normalizedName, node);
      }
      if (node.name.endsWith("新区") && node.name.length > 2) {
        const baseName = node.name.slice(0, -2);
        if (baseName !== node.normalizedName) {
          addToIndex(this.byNormalizedName, baseName, node);
        }
      }
    }

    return node;
  }

  resolve(rawQuery: string): RegionResolution {
    const query = rawQuery.trim().replaceAll(" ", "");
    if (!query) return { status: "not_found", matches: [] };

    // 国标代码和省级常用别名可以直接得到唯一节点。
    if (/^\d+$/.test(query)) {
      const codeNode = this.nodes.get(query);
      if (codeNode) return this.pack([codeNode]);
    }
    const alias = PROVINCE_ALIASES[query];
    if (alias) {
      const aliasNode = this.byName.get(alias)?.[0];
      if (aliasNode) return this.pack([aliasNode]);
    }

    const compoundMatches = this.matchCompoundName(query);
    if (compoundMatches.length > 0) return this.pack(compoundMatches);

    // 带完整后缀的输入只做精确匹配，避免引入同名但层级不同的节点。
    const exactMatches = this.byName.get(query);
    if (exactMatches && exactMatches.length > 0) return this.pack(exactMatches);

    const normalizedQuery = stripRegionSuffix(query);
    const merged: RegionNode[] = [];
    const seenCodes = new Set<string>();
    for (const node of [
      ...(this.byNormalizedName.get(normalizedQuery) ?? []),
      ...(this.byName.get(normalizedQuery) ?? []),
    ]) {
      if (!seenCodes.has(node.code)) {
        seenCodes.add(node.code);
        merged.push(node);
      }
    }

    return merged.length > 0
      ? this.pack(merged)
      : { status: "not_found", matches: [] };
  }

  private matchCompoundName(query: string): RegionNode[] {
    const matches: RegionNode[] = [];
    const seenCodes = new Set<string>();

    // 将输入切成“祖先前缀 + 目标尾部”，目标尾部可使用全名或简称。
    for (let index = 1; index < query.length; index += 1) {
      const prefix = query.slice(0, index);
      const tail = query.slice(index);
      const candidates =
        this.byName.get(tail) ??
        this.byNormalizedName.get(stripRegionSuffix(tail)) ??
        [];

      for (const node of candidates) {
        if (
          !seenCodes.has(node.code) &&
          this.prefixMatchesAncestors(prefix, node)
        ) {
          seenCodes.add(node.code);
          matches.push(node);
        }
      }
    }
    return matches;
  }

  private prefixMatchesAncestors(prefix: string, node: RegionNode): boolean {
    let remaining = prefix;

    // 祖先从最外层向父节点消费；允许省略中间层级，如“江苏鼓楼区”。
    for (const [fullName, normalizedName] of [...node.ancestors].reverse()) {
      if (!remaining) break;
      if (fullName && remaining.startsWith(fullName)) {
        remaining = remaining.slice(fullName.length);
      } else if (normalizedName && remaining.startsWith(normalizedName)) {
        remaining = remaining.slice(normalizedName.length);
      }
    }
    return remaining.length === 0;
  }

  private pack(nodes: RegionNode[]): RegionResolution {
    const ordered = [...nodes].sort(
      (left, right) => right.level - left.level || left.code.localeCompare(right.code),
    );
    const matches = ordered.map((node) => this.toMatch(node));
    return {
      status: matches.length === 1 ? "unique" : "ambiguous",
      matches,
    };
  }

  private toMatch(node: RegionNode): RegionMatch {
    const path = [node.provinceName];
    if (
      node.level >= 3 &&
      node.cityName &&
      !PLACEHOLDER_CITY_NAMES.has(node.cityName) &&
      node.cityName !== node.provinceName
    ) {
      path.push(node.cityName);
    }
    if (node.level >= 2 && node.name !== node.provinceName) {
      path.push(node.name);
    }

    return {
      code: node.code,
      level: node.level,
      name: node.name,
      full_path: path.filter((item, index) => item !== path[index - 1]).join(" / "),
      l1_code: node.provinceCode,
      l1_name: node.provinceName,
    };
  }
}

let sharedRegionIndex: RegionIndex | undefined;

/** 解析地区名称；歧义时只返回候选，由上层 Agent 向用户确认。 */
export const resolveEnterpriseRegion = (query: string): RegionResolution => {
  sharedRegionIndex ??= new RegionIndex(regionData);
  return sharedRegionIndex.resolve(query);
};
