"use client";

import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./page.module.scss";

type MarkdownContentProps = {
  value: string;
  emptyText?: string;
  className?: string;
};

/**
 * 所有模板预览共用同一组安全渲染规则。
 * 原始 HTML 被忽略，图片只显示替代文字，避免模板内容触发脚本或远程资源请求。
 */
const markdownComponents: Components = {
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
    >
      {children}
    </a>
  ),
  img: ({ alt }) => (
    <span className={styles.markdownImagePlaceholder}>
      {alt ? `[图片：${alt}]` : "[图片已禁用]"}
    </span>
  ),
};

/** 渲染 CommonMark 与 GFM，但不扩展单换行的标准语义。 */
export default function MarkdownContent({
  value,
  emptyText = "暂无可预览内容",
  className,
}: MarkdownContentProps) {
  if (!value.trim()) {
    return <p className={styles.markdownEmpty}>{emptyText}</p>;
  }

  return (
    <div className={[styles.markdownContent, className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={defaultUrlTransform}
        components={markdownComponents}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}
