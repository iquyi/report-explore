import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNoSourceDisclosure,
  ECHARTS_CDN_URL,
  extractReportTitle,
  REPORT_BACKGROUND_IMAGE_URLS,
  sanitizeReportHtml,
} from "../html-safety";

test("只从 head 的 title 提取并清理报告标题", () => {
  const html = `
    <html><head><title> 浪潮云 &amp; 企业报告 </title></head>
    <body><svg><title>图表标题</title></svg></body></html>
  `;

  assert.equal(extractReportTitle(html), "浪潮云 & 企业报告");
  assert.equal(extractReportTitle("<html><body><title>正文标题</title></body></html>"), "企业报告");
});

test("清洗危险标签、属性和 CSS 网络资源，并注入 CSP", () => {
  const html = sanitizeReportHtml(`
    <!doctype html><html><head><style>
      @import url(https://evil.example/a.css);
      .hero { background: url(https://evil.example/a.png); color: #123; }
    </style></head><body>
      <script src="https://evil.example/attack.js">alert(1)</script>
      <form><input></form><iframe src="https://evil.example"></iframe>
      <h1 onclick="alert(1)">安全报告</h1>
      <a href="javascript:alert(1)">坏链接</a>
      <a href="https://example.com/source">来源</a>
    </body></html>
  `);

  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /<script|<form|<input|<iframe|onclick=/i);
  assert.doesNotMatch(html, /@import|url\s*\(/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /href="https:\/\/example\.com\/source"/);
  assert.match(html, /<a>来源<\/a>/);
});

test("保留固定 ECharts CDN、初始化脚本和绘图元素，同时阻断其他外部资源", () => {
  const html = sanitizeReportHtml(`
    <!doctype html><html><head><style>
      .chart { clip-path: url(#plot); background: url(https://evil.example/a.png); }
    </style><script src="${ECHARTS_CDN_URL}" integrity="discarded"></script></head><body>
      <div style="--value:72%;background:url(https://evil.example/b.png)" data-value="72">72%</div>
      <svg viewBox="0 0 100 40" role="img" aria-labelledby="chart-title">
        <title id="chart-title">趋势图</title>
        <defs><linearGradient id="fill"><stop offset="0" stop-color="#1769e0" /></linearGradient></defs>
        <path d="M0 40L50 10L100 20" fill="none" stroke="url(#fill)" onclick="alert(1)" />
        <use href="https://evil.example/shape.svg#node" />
      </svg>
      <canvas width="400" height="200" aria-label="图表画布">图表数据后备文本</canvas>
      <script>window.reportChartReady = Boolean(window.echarts);</script>
      <script src="https://evil.example/attack.js">window.reportChartCompromised = true;</script>
    </body></html>
  `);

  assert.ok(html.includes(`script-src 'unsafe-inline' ${ECHARTS_CDN_URL}`));
  assert.ok(html.includes(`<script src="${ECHARTS_CDN_URL}"></script>`));
  assert.match(html, /<script>window\.reportChartReady = Boolean\(window\.echarts\);<\/script>/);
  assert.match(html, /style="--value:72%;background:none"/);
  assert.match(html, /data-value="72"/);
  assert.match(html, /<svg[^>]+viewBox="0 0 100 40"/);
  assert.match(html, /<linearGradient id="fill">/);
  assert.match(html, /stroke="url\(#fill\)"/);
  assert.match(html, /<canvas width="400" height="200"/);
  assert.doesNotMatch(html, /evil\.example|onclick=|integrity=|reportChartCompromised/i);
});

test("仅保留设计规范固定背景图并通过 CSP 放行对应图片域名", () => {
  const allowedBackgrounds = REPORT_BACKGROUND_IMAGE_URLS.map(
    (url, index) => `--background-${index + 1}:url('${url}');`,
  ).join("\n");
  const html = sanitizeReportHtml(`
    <!doctype html><html><head><style>
      :root { ${allowedBackgrounds} }
      .same-origin-unknown { background-image: url("https://pic.s3.link-x.cn/2026/not-allowed.png"); }
      .other-origin { background-image: url("https://evil.example/background.png"); }
    </style></head><body><h1>背景图报告</h1></body></html>
  `);

  assert.ok(html.includes("img-src https://pic.s3.link-x.cn"));
  for (const url of REPORT_BACKGROUND_IMAGE_URLS) {
    assert.ok(html.includes(`url("${url}")`));
  }
  assert.doesNotMatch(html, /not-allowed\.png|evil\.example/i);
  assert.match(html, /\.same-origin-unknown \{ background-image: none; \}/);
  assert.match(html, /\.other-origin \{ background-image: none; \}/);
});

test("仅包含内联脚本而没有可见正文时拒绝交付", () => {
  assert.throws(() => sanitizeReportHtml("<script>alert(1)</script>"));
});

test("最终交付拒绝来源栏目、渠道名称和正文 URL", () => {
  for (const disclosure of [
    "数据来源：内部平台",
    "通过联网检索获得",
    "参考出处",
    "https://example.com/source",
  ]) {
    assert.throws(
      () => sanitizeReportHtml(`<html><body><p>${disclosure}</p></body></html>`),
      /不可展示的数据来源信息/,
    );
  }
  assert.throws(
    () => assertNoSourceDisclosure("报告附注：资料来源见内部系统"),
    /不可展示的数据来源信息/,
  );
});
