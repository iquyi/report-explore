"use client";

import { useId, useRef } from "react";
import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";
import styles from "./page.module.scss";

type UploadCardProps = {
  title: string;
  accept: string;
  formatLabel: string;
  file: File | null;
  onChange: (file: File | null) => void;
};

/** 原生文件控件负责选择，HeroUI 按钮负责可见操作；文件内容不会被读取。 */
export default function UploadCard({ title, accept, formatLabel, file, onChange }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const size = file ? (file.size < 1024 ? `${file.size} B` : file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`) : "";

  return (
    <section className={styles.uploadCard} aria-labelledby={titleId}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        aria-label={`选择${title}`}
        onChange={(event) => {
          const selected = event.currentTarget.files?.[0];
          // 取消选择或选择了不符合扩展名的文件时，保留原文件。
          if (selected && accept.split(",").some((extension) => selected.name.toLowerCase().endsWith(extension))) {
            onChange(selected);
          }
          // 清空原生值以允许重新选择同一个文件，已选文件仍由父组件持有。
          event.currentTarget.value = "";
        }}
      />
      <div className={styles.uploadHeading}>
        <Icon icon={title === "蓝图" ? "tabler:layout-dashboard" : "tabler:file-description"} width={18} aria-hidden="true" />
        <h3 id={titleId}>{title}</h3>
      </div>
      <p className={styles.fileName} title={file?.name}>{file?.name ?? formatLabel}</p>
      <div className={styles.uploadFooter}>
        <span className={styles.fileSize}>{file ? size : "最多 1 份"}</span>
        <div className={styles.fileActions}>
          <Button type="button" size="sm" variant="ghost" aria-label={`${file ? "替换" : "选择"}${title}`} onPress={() => inputRef.current?.click()}>
            {file ? "替换" : "选择文件"}
          </Button>
          {file && <Button type="button" size="sm" variant="ghost" isIconOnly aria-label={`移除${title}`} onPress={() => onChange(null)}><Icon icon="tabler:x" width={15} aria-hidden="true" /></Button>}
        </div>
      </div>
    </section>
  );
}
