"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { TextArea } from "@heroui/react";
import MarkdownContent from "./MarkdownContent";
import styles from "./page.module.scss";

type MarkdownEditorProps = {
  value: string;
  maxLength: number;
  rows?: number;
  placeholder: string;
  ariaDescribedBy?: string;
  autoResize?: boolean;
  onBlur?: () => void;
};

/**
 * 保留原始 Markdown 源码作为唯一可编辑值，仅在预览页进行渲染。
 * 组件不维护内容副本，因此切换模式不会影响父级 TextField 的受控状态。
 */
export default function MarkdownEditor({
  value,
  maxLength,
  rows = 4,
  placeholder,
  ariaDescribedBy,
  autoResize = false,
  onBlur,
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const editTabId = `${id}-edit-tab`;
  const previewTabId = `${id}-preview-tab`;
  const panelId = `${id}-panel`;

  // 长规则字段随内容和容器宽度自动调整；变量弹窗保留固定高度，避免弹窗持续增长。
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!autoResize || mode !== "edit" || !textarea) return;

    const resize = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight + 2}px`;
    };
    resize();

    let previousWidth = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === previousWidth) return;
      previousWidth = textarea.clientWidth;
      resize();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [autoResize, mode, value]);

  const selectMode = (nextMode: "edit" | "preview") => {
    // 预览前主动提交当前源码；自动保存 Hook 会去重随后发生的 blur 事件。
    if (nextMode === "preview" && mode === "edit") onBlur?.();
    setMode(nextMode);
  };

  return (
    <div className={styles.markdownEditor}>
      <div className={styles.markdownTabs} role="tablist" aria-label="Markdown 显示模式">
        <button
          id={editTabId}
          type="button"
          role="tab"
          aria-selected={mode === "edit"}
          aria-controls={panelId}
          className={mode === "edit" ? styles.markdownTabActive : styles.markdownTab}
          onClick={() => selectMode("edit")}
        >
          编辑
        </button>
        <button
          id={previewTabId}
          type="button"
          role="tab"
          aria-selected={mode === "preview"}
          aria-controls={panelId}
          className={mode === "preview" ? styles.markdownTabActive : styles.markdownTab}
          onClick={() => selectMode("preview")}
        >
          预览
        </button>
      </div>

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={mode === "edit" ? editTabId : previewTabId}
        className={styles.markdownPanel}
      >
        {mode === "edit" ? (
          <TextArea
            ref={textareaRef}
            rows={rows}
            maxLength={maxLength}
            className={styles.ruleTextarea}
            aria-describedby={ariaDescribedBy}
            placeholder={placeholder}
            onBlur={onBlur}
          />
        ) : (
          <MarkdownContent value={value} className={styles.markdownPreview} />
        )}
      </div>
    </div>
  );
}
