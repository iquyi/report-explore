import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const { SKILL_DIR, TMP_DIR, RUNTIME_PYTHON, FINAL_PPTX } = process.env;
const workspaceDir = "/Users/quyi/Desktop/link-x/report-explore";
const sourcePath = "/Users/quyi/Desktop/9月微创新申报材料-曲艺.pptx";

if (![SKILL_DIR, TMP_DIR, RUNTIME_PYTHON, FINAL_PPTX].every((value) => path.isAbsolute(value ?? ""))) {
  throw new Error("SKILL_DIR, TMP_DIR, RUNTIME_PYTHON and FINAL_PPTX must be absolute paths");
}

const { finalizePresentation } = await import(
  pathToFileURL(path.join(SKILL_DIR, "container_tools/artifact_tool_utils.mjs")).href
);

// 读取原稿后保留全部母版、布局、主题和既有页面，只在副本中增加两页。
const presentation = await PresentationFile.importPptx(await FileBlob.load(sourcePath));
const sourceTwoColumn = presentation.slides.getItem(5);
const sourceLifecycle = presentation.slides.getItem(15);
const roadmapSlide = presentation.slides.getItem(16);

// 通过原始 shape name 定位对象，避免依赖导入后可能变化的内部标识。
function shapeByName(slide, name) {
  const shape = slide.shapes.items.find((item) => item.name === name);
  if (!shape) throw new Error(`Shape not found: ${name}`);
  return shape;
}

// 统一设置文本并明确字体，保证新增中文内容延续原稿的视觉表现。
function setText(shape, text, style = {}) {
  shape.text = text;
  shape.text.style = {
    typeface: "Hiragino Sans GB",
    autoFit: "shrinkText",
    wrap: "square",
    ...style,
  };
}

// ---------- 第 17 页：用户与一线团队的个性化交付 ----------
const valueSlide = sourceTwoColumn.duplicate();
valueSlide.moveTo(16);

setText(shapeByName(valueSlide, "矩形 1"), "05 · 核心价值", {
  fontSize: 16,
  bold: true,
  color: "#2F6FA5",
  alignment: "left",
  verticalAlignment: "middle",
});
setText(shapeByName(valueSlide, "矩形 2"), "面向用户与一线团队的个性化交付", {
  fontSize: 45.33,
  bold: true,
  color: "#173252",
  alignment: "left",
  verticalAlignment: "middle",
});
setText(shapeByName(valueSlide, "矩形 4"), "PROMPT 即模板", {
  fontSize: 11.33,
  color: "#8CA0B6",
  alignment: "left",
});
setText(shapeByName(valueSlide, "矩形 5"), "16", {
  fontSize: 12,
  color: "#8CA0B6",
  alignment: "right",
});

setText(shapeByName(valueSlide, "s6-left-kicker"), "用户价值", {
  fontSize: 17.33,
  bold: true,
  color: "#2F6FA5",
  alignment: "left",
});
setText(shapeByName(valueSlide, "s6-left-title"), "千人千面", {
  fontSize: 38.67,
  bold: true,
  color: "#173252",
  alignment: "left",
});
const leftBody = shapeByName(valueSlide, "s6-left-body");
leftBody.position = { left: 160, top: 388, width: 430, height: 116 };
setText(leftBody, "用户可按角色和场景灵活调整\n报告章节、指标范围与表达方式\n同一模板输出不同侧重点", {
  fontSize: 18,
  color: "#61748C",
  alignment: "left",
  verticalAlignment: "top",
  lineSpacing: 1.25,
});

setText(shapeByName(valueSlide, "s6-right-kicker"), "一线价值", {
  fontSize: 17.33,
  bold: true,
  color: "#4D9187",
  alignment: "left",
});
setText(shapeByName(valueSlide, "s6-right-title"), "客户专属", {
  fontSize: 38.67,
  bold: true,
  color: "#173252",
  alignment: "left",
});
const rightBody = shapeByName(valueSlide, "s6-right-body");
rightBody.position = { left: 725.27, top: 388, width: 416.33, height: 116 };
setText(rightBody, "产品与销售无需从零编写\n基于模板融合公司独有数据\n报告类型随模板持续扩展", {
  fontSize: 18,
  color: "#61748C",
  alignment: "left",
  verticalAlignment: "top",
  lineSpacing: 1.25,
});

setText(shapeByName(valueSlide, "s6-common"), "模板约束专业边界，Agent 提升个性化报告的生成效率。", {
  fontSize: 21.33,
  bold: true,
  color: "#173252",
  alignment: "center",
  verticalAlignment: "middle",
});
valueSlide.speakerNotes.textFrame.setText("");

// ---------- 第 18 页：交互能力随报告生命周期流转 ----------
const lifecycleSlide = sourceLifecycle.duplicate();
lifecycleSlide.moveTo(17);

setText(shapeByName(lifecycleSlide, "矩形 1"), "05 · 核心价值", {
  fontSize: 16,
  bold: true,
  color: "#2F6FA5",
  alignment: "left",
  verticalAlignment: "middle",
});
setText(shapeByName(lifecycleSlide, "矩形 2"), "HTML 让交互能力随报告一起流转", {
  fontSize: 45.33,
  bold: true,
  color: "#173252",
  alignment: "left",
  verticalAlignment: "middle",
});
setText(shapeByName(lifecycleSlide, "矩形 4"), "PROMPT 即模板", {
  fontSize: 11.33,
  color: "#8CA0B6",
  alignment: "left",
});
setText(shapeByName(lifecycleSlide, "矩形 5"), "17", {
  fontSize: 12,
  color: "#8CA0B6",
  alignment: "right",
});

// 上方轨道表示传统页面访问周期，保留原模板节点配色，通过文字层级降低视觉权重。
for (let index = 1; index <= 4; index += 1) {
  setText(shapeByName(lifecycleSlide, `s16-station-${index}-text`), String(index), {
    fontSize: 22.67,
    bold: true,
    color: "#FFFFFF",
    alignment: "center",
    verticalAlignment: "middle",
  });
}

const traditionalTitles = ["打开业务页面", "交互能力生效", "用户离开页面", "本次触达结束"];
const traditionalBodies = [
  "用户进入指定页面",
  "组件在当前会话中运行",
  "页面访问会话结束",
  "能力停留在单次访问",
];
for (let index = 1; index <= 4; index += 1) {
  setText(shapeByName(lifecycleSlide, `s16-title-${index}`), traditionalTitles[index - 1], {
    fontSize: 20,
    bold: true,
    color: "#53687D",
    alignment: "center",
    verticalAlignment: "middle",
  });
  setText(shapeByName(lifecycleSlide, `s16-body-${index}`), traditionalBodies[index - 1], {
    fontSize: 14.67,
    color: "#7A8DA1",
    alignment: "center",
    verticalAlignment: "top",
  });
}

const traditionalLabel = lifecycleSlide.shapes.add({
  geometry: "textbox",
  name: "value-traditional-cycle-label",
  position: { left: 114, top: 188, width: 260, height: 28 },
  fill: "none",
  line: { fill: "none", width: 0 },
});
setText(traditionalLabel, "页面访问周期", {
  fontSize: 16,
  bold: true,
  color: "#7A8DA1",
  alignment: "left",
  verticalAlignment: "middle",
});

// 下方轨道表示报告生命周期，继续使用原稿的四色节点强调传播与持续触达。
setText(shapeByName(lifecycleSlide, "s16-ownership"), "报告生命周期", {
  fontSize: 16,
  bold: true,
  color: "#2F6FA5",
  alignment: "left",
  verticalAlignment: "middle",
});

const lifecycleTitles = ["报告生成", "随报告保存", "随分享传播", "持续触达"];
const lifecycleBodies = [
  "Agent 组合模板与组件",
  "交互能力随载体保留",
  "报告在组织内外流转",
  "再次访问仍可连接产品服务",
];
for (let index = 1; index <= 4; index += 1) {
  setText(shapeByName(lifecycleSlide, `s16-owner-team-${index}`), lifecycleTitles[index - 1], {
    fontSize: 18,
    bold: true,
    color: ["#2F6FA5", "#57BDE4", "#4D9187", "#1957C8"][index - 1],
    alignment: "left",
    verticalAlignment: "middle",
  });
  setText(shapeByName(lifecycleSlide, `s16-owner-body-${index}`), lifecycleBodies[index - 1], {
    fontSize: 13.33,
    color: "#61748C",
    alignment: "left",
    verticalAlignment: "top",
  });
}

const safetyNote = lifecycleSlide.shapes.add({
  geometry: "textbox",
  name: "value-safety-boundary-note",
  position: { left: 160, top: 626, width: 960, height: 30 },
  fill: "none",
  line: { fill: "none", width: 0 },
});
setText(safetyNote, "仅调用经过审核的组件，并继续遵循既有的数据权限与服务边界。", {
  fontSize: 14,
  bold: true,
  color: "#173252",
  alignment: "center",
  verticalAlignment: "middle",
});
lifecycleSlide.speakerNotes.textFrame.setText("");

// 建设路线页顺延后更新页脚编号，其他既有页面内容保持不变。
setText(shapeByName(roadmapSlide, "矩形 5"), "18", {
  fontSize: 12,
  color: "#8CA0B6",
  alignment: "right",
});

// 输出受影响页面的预览和布局数据，供后续视觉检查与几何检查使用。
await fs.mkdir(TMP_DIR, { recursive: true });
for (const [label, slide] of [
  ["slide-17", valueSlide],
  ["slide-18", lifecycleSlide],
  ["slide-19", roadmapSlide],
]) {
  const png = await slide.export({ format: "png", scale: 2 });
  await fs.writeFile(path.join(TMP_DIR, `${label}.png`), new Uint8Array(await png.arrayBuffer()));
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(path.join(TMP_DIR, `${label}.layout.json`), await layout.text());
}

// 最终文件在工作区内通过完整性、版式、字体和再次导入检查后再交付。
const sourceBytes = await fs.readFile(sourcePath);
const sourceSha256 = crypto.createHash("sha256").update(sourceBytes).digest("hex");
const stagingDir = path.join(workspaceDir, ".codex-finalizer");
const candidatePath = path.join(stagingDir, "candidate-core-value-enhanced.pptx");
await fs.mkdir(stagingDir, { recursive: true });
await fs.mkdir(path.dirname(FINAL_PPTX), { recursive: true });
await (await PresentationFile.exportPptx(presentation)).save(candidatePath);

const result = await finalizePresentation({
  workspaceDir,
  candidatePath,
  finalPath: FINAL_PPTX,
  explicitTotalSlideCount: 20,
  requiredNativeTableOwnerSlides: [],
  requiredNativeChartOwnerSlides: [],
  pythonExecutable: RUNTIME_PYTHON,
  integrityValidatorPath: path.join(SKILL_DIR, "container_tools/inspect_presentation_package_integrity.py"),
  layoutValidatorPath: path.join(SKILL_DIR, "container_tools/inspect_presentation_layout_geometry.py"),
  layoutArgs: [
    "--expected-slide-size-emu",
    "12192000,6858000",
    "--validate-bullet-geometry",
    "--validate-heading-fit",
  ],
  fontPolicy: {
    basis: "reference",
    families: ["Hiragino Sans GB", "Hiragino Sans GB W6"],
    referencePath: sourcePath,
    referenceSha256: sourceSha256,
  },
  verifyArtifactToolImport: true,
  receiptPath: path.join(stagingDir, `${path.basename(FINAL_PPTX)}.validation.json`),
});

console.log(JSON.stringify({ finalPath: FINAL_PPTX, slideCount: presentation.slides.items.length, result }, null, 2));
