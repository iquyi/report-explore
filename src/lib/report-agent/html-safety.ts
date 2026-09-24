import sanitizeHtml from "sanitize-html";

const CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "worker-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'none'",
  "font-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "connect-src 'none'",
].join("; ");

/** 用户可见报告不得包含数据渠道、来源栏目或可复制访问的外部 URL。 */
const SOURCE_DISCLOSURE_PATTERN =
  /灵犀|tavily|演示资料|联网检索|(?:数据|资料|信息|参考)(?:来源|出处)|来源(?:清单|说明|渠道)|https?:\/\//i;

/** HTML 代码块之外的 Markdown 也会进入客户端，因此交付前统一执行来源披露检查。 */
export function assertNoSourceDisclosure(input: string) {
  if (SOURCE_DISCLOSURE_PATTERN.test(input)) {
    throw new Error("报告包含不可展示的数据来源信息。");
  }
}

/**
 * 在 sanitize-html 的通用语义标签上补充完整文档、内嵌样式、Canvas 和
 * ECharts 服务端渲染常见的 SVG 标签。危险或会加载外部资源的标签不在白名单中。
 */
const ALLOWED_TAGS = [
  ...sanitizeHtml.defaults.allowedTags,
  "html", "head", "meta", "title", "style", "body", "canvas", "details",
  "summary", "svg", "g", "defs", "symbol", "use", "path", "rect", "circle",
  "ellipse", "line", "polyline", "polygon", "text", "tspan", "textPath",
  "clipPath", "mask", "linearGradient", "radialGradient", "stop", "pattern",
  "filter", "feGaussianBlur", "feOffset", "feBlend", "feColorMatrix",
  "feComponentTransfer", "feFuncR", "feFuncG", "feFuncB", "feFuncA",
  "feMerge", "feMergeNode", "marker", "desc",
];

/**
 * 保留 SVG 渐变、裁剪和滤镜所需的本地片段引用，删除其他 CSS 资源加载与
 * 旧式可执行表达式。CSP 仍会作为浏览器侧的第二道外部访问防线。
 */
const sanitizeCss = (css: string) =>
  css
    .replace(/@import[\s\S]*?;/gi, "")
    .replace(/url\s*\(([^)]*)\)/gi, (_match, rawValue: string) => {
      const value = rawValue.trim().replace(/^(['"])(.*)\1$/, "$2").trim();
      return /^#[\w:.-]+$/.test(value) ? `url(${value})` : "none";
    })
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(/-moz-binding\s*:[^;}]+[;}]/gi, "");

/** 样式块和行内 style 使用同一套最小资源清洗规则。 */
const sanitizeStyleBlocks = (html: string) =>
  html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_tag, css: string) => {
    return `<style>${sanitizeCss(css)}</style>`;
  });

/** 清理允许属性中仍可能发起资源请求的值，并统一行内 CSS 的处理。 */
const sanitizeAttributes = (
  attributes: Record<string, string>,
) => {
  const safe = { ...attributes };
  if (safe.style) safe.style = sanitizeCss(safe.style);

  for (const name of ["href", "xlink:href"]) {
    const value = safe[name];
    if (value && !value.startsWith("#")) {
      delete safe[name];
    }
  }

  for (const name of [
    "fill", "stroke", "filter", "clip-path", "mask",
    "marker-start", "marker-mid", "marker-end",
  ]) {
    if (safe[name]?.includes("url(")) safe[name] = sanitizeCss(safe[name]);
  }

  return safe;
};

const ensureDocument = (html: string) => {
  const hasHtml = /<html\b/i.test(html);
  const documentHtml = hasHtml ? html : `<html><head></head><body>${html}</body></html>`;
  const withHead = /<head\b/i.test(documentHtml)
    ? documentHtml
    : documentHtml.replace(/<html\b[^>]*>/i, "$&<head></head>");
  const withBody = /<body\b/i.test(withHead)
    ? withHead
    : withHead.replace(/<\/html>/i, "<body></body></html>");
  return /^\s*<!doctype html>/i.test(withBody)
    ? withBody
    : `<!doctype html>${withBody}`;
};

/**
 * 仅从文档 head 中读取标题，避免把正文或 SVG 内的 title 误当成报告标题。
 * 标题按纯文本处理并限制长度，确保它可以安全进入 UI 消息和日志元数据。
 */
export function extractReportTitle(input: string, fallback = "企业报告") {
  const head = input.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1];
  const rawTitle = head?.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (!rawTitle) return fallback;

  const escapedTitle = sanitizeHtml(rawTitle, {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(/\s+/g, " ")
    .trim();
  // sanitize-html 会保留实体编码；标题作为普通 UI 文本返回前恢复常用及数字实体。
  const title = escapedTitle.replace(
    /&(?:amp|lt|gt|quot|#39|#x[\da-f]+|#\d+);/gi,
    (entity) => {
      const named: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&#39;": "'",
      };
      const normalized = entity.toLowerCase();
      if (named[normalized]) return named[normalized];
      const codePoint = normalized.startsWith("&#x")
        ? Number.parseInt(normalized.slice(3, -1), 16)
        : Number.parseInt(normalized.slice(2, -1), 10);
      return Number.isSafeInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    },
  );
  return title.slice(0, 200) || fallback;
}

/** 最终交付前的硬安全边界，与模型语义审查结果无关且始终执行。 */
export function sanitizeReportHtml(input: string) {
  const cleaned = sanitizeHtml(sanitizeStyleBlocks(input), {
    allowedTags: ALLOWED_TAGS,
    // 报告允许自由的静态样式、ARIA/data 属性和常见 SVG 绘图属性，但不允许事件属性。
    allowVulnerableTags: true,
    allowedAttributes: {
      html: ["lang"],
      meta: ["charset", "name", "content"],
      "*": [
        "id", "class", "style", "title", "lang", "dir", "role", "tabindex",
        "aria-*", "data-*", "xmlns", "xmlns:xlink", "width", "height", "viewBox",
        "preserveAspectRatio", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy",
        "r", "rx", "ry", "d", "points", "transform", "fill", "fill-opacity",
        "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
        "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "opacity",
        "font-family", "font-size", "font-style", "font-weight", "text-anchor",
        "dominant-baseline", "vector-effect", "paint-order", "href", "xlink:href",
        "clip-path", "clip-rule", "mask", "filter", "marker-start", "marker-mid",
        "marker-end", "markerWidth", "markerHeight", "refX", "refY", "orient",
        "gradientUnits", "gradientTransform", "offset", "stop-color", "stop-opacity",
        "patternUnits", "patternContentUnits", "patternTransform", "pathLength",
      ],
      a: ["href", "title", "target", "rel"],
      time: ["datetime"],
      ol: ["start", "reversed", "type"],
      li: ["value"],
      details: ["open"],
      canvas: ["width", "height"],
      th: ["scope", "colspan", "rowspan", "headers", "abbr"],
      td: ["colspan", "rowspan", "headers"],
      col: ["span"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowProtocolRelative: false,
    parser: {
      // SVG 标签和属性区分大小写，例如 linearGradient 与 viewBox。
      lowerCaseTags: false,
      lowerCaseAttributeNames: false,
    },
    transformTags: {
      "*": (tagName, attributes) => ({
        tagName,
        attribs: sanitizeAttributes(attributes),
      }),
      a: (tagName, attributes) => {
        const safe = sanitizeAttributes(attributes);
        return {
          tagName,
          attribs: safe,
        };
      },
    },
  });

  const complete = ensureDocument(cleaned);
  const visibleText = complete
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|\s/gi, "");
  if (!visibleText || !/<body\b/i.test(complete)) {
    throw new Error("报告清洗后没有可交付内容。");
  }
  assertNoSourceDisclosure(visibleText);

  return complete.replace(
    /<head\b[^>]*>/i,
    `$&<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
  );
}
