"use client";

import { useCallback, useRef } from "react";
import { toast } from "@heroui/react";
import type { ActionResult } from "../types";
import { useAutoSaveStatus } from "./AutoSaveStatus";

type UseAutoSaveFieldOptions<T> = {
  initialValue: T;
  serialize: (value: T) => string;
  save: (value: T) => Promise<ActionResult<unknown>>;
};

/**
 * 统一处理字段变化比较和串行保存。
 * structuredClone 为排队任务保留独立快照，避免数组随后变化影响已经提交的值。
 */
export default function useAutoSaveField<T>({
  initialValue,
  serialize,
  save,
}: UseAutoSaveFieldOptions<T>) {
  const { startSaving, finishSaving } = useAutoSaveStatus();
  const initialSerialized = serialize(initialValue);
  const savedSerializedRef = useRef(initialSerialized);
  const queuedSerializedRef = useRef(initialSerialized);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const saveIfChanged = useCallback(
    (nextValue: T) => {
      const snapshot = structuredClone(nextValue);
      const serialized = serialize(snapshot);

      // 已保存或已经进入队列的相同内容无需重复请求。
      if (serialized === queuedSerializedRef.current) return;

      queuedSerializedRef.current = serialized;
      // 入队时立即显示保存中，包括等待前一个字段请求完成的时间。
      startSaving();

      queueRef.current = queueRef.current.then(async () => {
        try {
          if (serialized === savedSerializedRef.current) return;

          const result = await save(snapshot);

          if (result.success) {
            // 成功值成为下一次变化比较的基线。
            savedSerializedRef.current = serialized;
            return;
          }

          // 失败内容重新变为可保存状态，用户下次失焦或变量操作即可重试。
          if (queuedSerializedRef.current === serialized) {
            queuedSerializedRef.current = savedSerializedRef.current;
          }
          toast.danger(result.error);
        } catch (error) {
          console.error("Failed to auto-save template field.", error);
          if (queuedSerializedRef.current === serialized) {
            queuedSerializedRef.current = savedSerializedRef.current;
          }
          toast.danger("模板字段保存失败，请稍后重试。");
        } finally {
          // 成功、失败或因内容已保存而跳过，都会结束当前排队任务。
          finishSaving();
        }
      });
    },
    [finishSaving, save, serialize, startSaving],
  );

  return { saveIfChanged };
}
