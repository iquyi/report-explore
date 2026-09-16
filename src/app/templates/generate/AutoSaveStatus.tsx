"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";
import styles from "./page.module.scss";

type AutoSaveStatusContextValue = {
  pendingCount: number;
  startSaving: () => void;
  finishSaving: () => void;
};

const AutoSaveStatusContext = createContext<AutoSaveStatusContextValue | null>(
  null,
);

/**
 * 汇总页面内所有字段的保存任务。
 * 使用计数而不是布尔值，避免多个字段连续保存时过早显示“已保存”。
 */
export function AutoSaveStatusProvider({ children }: { children: ReactNode }) {
  const [pendingCount, setPendingCount] = useState(0);
  const startSaving = useCallback(() => {
    setPendingCount((count) => count + 1);
  }, []);
  const finishSaving = useCallback(() => {
    setPendingCount((count) => Math.max(0, count - 1));
  }, []);

  return (
    <AutoSaveStatusContext.Provider
      value={{ pendingCount, startSaving, finishSaving }}
    >
      {children}
    </AutoSaveStatusContext.Provider>
  );
}

/** 保存状态位于统一的礼貌播报区域，状态变化不会打断屏幕阅读器当前内容。 */
export function AutoSaveStatus() {
  const context = useContext(AutoSaveStatusContext);
  const isSaving = (context?.pendingCount ?? 0) > 0;

  return (
    <span className={styles.saveStatus} aria-live="polite" aria-atomic="true">
      {isSaving ? "保存中…" : "已保存"}
    </span>
  );
}

/** 自动保存 Hook 通过同一上下文报告每个排队任务的起止时间。 */
export function useAutoSaveStatus() {
  const context = useContext(AutoSaveStatusContext);
  if (!context) {
    throw new Error("useAutoSaveStatus must be used within AutoSaveStatusProvider.");
  }
  return context;
}
