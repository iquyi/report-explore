import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const { SKILL_DIR, TMP_DIR, RUNTIME_PYTHON, FINAL_PPTX } = process.env;
const workspaceDir = "/Users/quyi/Desktop/link-x/report-explore";
const sourcePath = "/Users/quyi/Desktop/9月微创新申报材料-曲艺-核心价值增强版.pptx";

if (![SKILL_DIR, TMP_DIR, RUNTIME_PYTHON, FINAL_PPTX].every((value) => path.isAbsolute(value ?? ""))) {
  throw new Error("SKILL_DIR, TMP_DIR, RUNTIME_PYTHON and FINAL_PPTX must be absolute paths");
}

const { finalizePresentation } = await import(
  pathToFileURL(path.join(SKILL_DIR, "container_tools/artifact_tool_utils.mjs")).href
);

const presentation = await PresentationFile.importPptx(await FileBlob.load(sourcePath));
const slide = presentation.slides.getItem(17);

// 通过 shape name 精确定位第 18 页原有对象，避免影响其他页面或母版。
function shapeByName(name) {
  const shape = slide.shapes.items.find((item) => item.name === name);
  if (!shape) throw new Error(`Shape not found on slide 18: ${name}`);
  return shape;
}

function setText(shape, text, style = {}) {
  shape.text = text;
  shape.text.style = {
    typeface: "Hiragino Sans GB",
    autoFit: "shrinkText",
    wrap: "square",
    ...style,
  };
}

// 隐藏旧的上下双时间线，但保留页头、Logo、背景、页脚和页面标题。
shapeByName("s16-track").line = { fill: "none", width: 0 };
shapeByName("s16-owner-baseline").fill = "none";
shapeByName("value-traditional-cycle-label").text = "";
shapeByName("value-safety-boundary-note").text = "";
shapeByName("s16-ownership").text = "";

for (let index = 1; index <= 4; index += 1) {
  const topCircle = shapeByName(`s16-station-${index}-circle`);
  topCircle.fill = "none";
  topCircle.line = { fill: "none", width: 0 };
  shapeByName(`s16-station-${index}-text`).text = "";
  shapeByName(`s16-title-${index}`).text = "";
  shapeByName(`s16-body-${index}`).text = "";

  const bottomDot = shapeByName(`s16-owner-dot-${index}`);
  bottomDot.fill = "none";
  bottomDot.line = { fill: "none", width: 0 };
  shapeByName(`s16-owner-team-${index}`).text = "";
  shapeByName(`s16-owner-body-${index}`).text = "";
}

// 主观点直接说明生命周期变化，传统方式仅作为一行弱化对照。
const mainStatement = slide.shapes.add({
  geometry: "textbox",
  name: "s18-main-lifecycle-statement",
  position: { left: 96, top: 176, width: 720, height: 48 },
  fill: "none",
  line: { fill: "none", width: 0 },
});
setText(mainStatement, "交互能力与报告共享生命周期", {
  fontSize: 28,
  bold: true,
  color: "#173252",
  alignment: "left",
  verticalAlignment: "middle",
});

const traditionalNote = slide.shapes.add({
  geometry: "textbox",
  name: "s18-traditional-note",
  position: { left: 790, top: 184, width: 390, height: 30 },
  fill: "none",
  line: { fill: "none", width: 0 },
});
setText(traditionalNote, "传统页面：离开页面后，本次触达随会话结束", {
  fontSize: 13.33,
  color: "#93A3B3",
  alignment: "right",
  verticalAlignment: "middle",
});

// 使用一条连续主线承载五个关键阶段，让新生命周期成为页面唯一视觉主体。
const lifecycleLine = slide.shapes.add({
  geometry: "line",
  name: "s18-lifecycle-line",
  position: { left: 140, top: 356, width: 1000, height: 0 },
  fill: "none",
  line: { style: "solid", fill: "#78C9EE", width: 5 },
});
lifecycleLine.sendToBack();

const stages = [
  {
    x: 110,
    color: "#2F6FA5",
    title: "生成报告",
    body: "模板与组件共同生成",
  },
  {
    x: 350,
    color: "#57BDE4",
    title: "携带能力",
    body: "交互组件进入报告",
  },
  {
    x: 590,
    color: "#4D9187",
    title: "保存分享",
    body: "能力随报告一起流转",
  },
  {
    x: 830,
    color: "#35AE91",
    title: "再次访问",
    body: "在权限范围内继续生效",
  },
  {
    x: 1070,
    color: "#1957C8",
    title: "持续触达",
    body: "连接公司的产品与服务",
  },
];

for (let index = 0; index < stages.length; index += 1) {
  const stage = stages[index];
  const node = slide.shapes.add({
    geometry: "ellipse",
    name: `s18-lifecycle-node-${index + 1}`,
    position: { left: stage.x, top: 320, width: 72, height: 72 },
    fill: stage.color,
    line: { fill: "none", width: 0 },
  });
  setText(node, String(index + 1).padStart(2, "0"), {
    fontSize: 20,
    bold: true,
    color: "#FFFFFF",
    alignment: "center",
    verticalAlignment: "middle",
  });

  const title = slide.shapes.add({
    geometry: "textbox",
    name: `s18-lifecycle-title-${index + 1}`,
    position: { left: stage.x - 54, top: 410, width: 180, height: 36 },
    fill: "none",
    line: { fill: "none", width: 0 },
  });
  setText(title, stage.title, {
    fontSize: 20,
    bold: true,
    color: stage.color,
    alignment: "center",
    verticalAlignment: "middle",
  });

  const body = slide.shapes.add({
    geometry: "textbox",
    name: `s18-lifecycle-body-${index + 1}`,
    position: { left: stage.x - 64, top: 452, width: 200, height: 52 },
    fill: "none",
    line: { fill: "none", width: 0 },
  });
  setText(body, stage.body, {
    fontSize: 14.67,
    color: "#61748C",
    alignment: "center",
    verticalAlignment: "top",
  });
}

// 页底以一句话解释“随报告传播”的价值，同时保留必要的权限前提。
const conclusion = slide.shapes.add({
  geometry: "textbox",
  name: "s18-lifecycle-conclusion",
  position: { left: 170, top: 562, width: 940, height: 54 },
  fill: "none",
  line: { fill: "none", width: 0 },
});
setText(
  conclusion,
  "只要报告仍可访问，经过审核的组件便能在权限范围内持续提供交互能力。",
  {
    fontSize: 18,
    bold: true,
    color: "#173252",
    alignment: "center",
    verticalAlignment: "middle",
  }
);

// 导出第 18 页预览和布局数据，用于视觉与几何核验。
await fs.mkdir(TMP_DIR, { recursive: true });
const preview = await slide.export({ format: "png", scale: 2 });
await fs.writeFile(path.join(TMP_DIR, "slide-18-lifecycle-focus.png"), new Uint8Array(await preview.arrayBuffer()));
const layout = await slide.export({ format: "layout" });
await fs.writeFile(path.join(TMP_DIR, "slide-18-lifecycle-focus.layout.json"), await layout.text());

// 在工作区完成最终校验，源文件和上一版增强文件均不覆盖。
const sourceBytes = await fs.readFile(sourcePath);
const sourceSha256 = crypto.createHash("sha256").update(sourceBytes).digest("hex");
const stagingDir = path.join(workspaceDir, ".codex-finalizer");
const candidatePath = path.join(stagingDir, "candidate-lifecycle-focus.pptx");
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
