"use client";

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { queryAvailableStyles } from "../styles/actions";
import type { ChatStyleOption } from "../styles/types";
import styles from "./List.module.scss";

type ListProps = {
  selectedStyle: ChatStyleOption | null;
  disabled: boolean;
  onSelectStyle: (style: ChatStyleOption) => void;
};

const List = ({ selectedStyle, disabled, onSelectStyle }: ListProps) => {
  const [styleItems, setStyleItems] = useState<ChatStyleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  // 页面进入或用户重试时读取数据库最新状态，卸载后忽略迟到的异步结果。
  useEffect(() => {
    let active = true;

    const loadStyles = async () => {
      setLoading(true);
      setLoadError("");
      try {
        const result = await queryAvailableStyles();
        if (!active) return;
        if (!result.success) {
          setLoadError(result.error);
          return;
        }
        setStyleItems(result.data);
      } catch (error) {
        console.error("Failed to load available styles.", error);
        if (active) setLoadError("设计风格加载失败，请稍后重试。");
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadStyles();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  return (
    <section className={styles.list} aria-labelledby="style-list-title">
      <h2 className={styles.groupTitle} id="style-list-title">
        设计风格
      </h2>

      {loading && (
        <p className={styles.feedback} role="status">
          <Icon icon="tabler:loader-2" width={17} aria-hidden="true" />
          正在加载设计风格…
        </p>
      )}

      {!loading && loadError && (
        <div className={styles.feedback} role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={() => setReloadKey((value) => value + 1)}>
            重新加载
          </button>
        </div>
      )}

      {!loading && !loadError && styleItems.length === 0 && (
        <p className={styles.feedback}>暂无可用设计风格</p>
      )}

      {!loading && !loadError && styleItems.length > 0 && (
        <div className={styles.grid}>
          {styleItems.map((style) => {
            const selected = selectedStyle?.id === style.id;
            return (
              <button
                className={`${styles.styleCard} ${selected ? styles.styleCardSelected : ""}`}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                key={style.id}
                onClick={() => onSelectStyle(style)}
              >
                <span className={styles.cover}>
                  <Icon
                    icon={selected ? "tabler:check" : "tabler:palette"}
                    width={24}
                    aria-hidden="true"
                  />
                  <span>{style.description}</span>
                </span>
                <span className={styles.templateName}>
                  {style.name}
                  {style.isDefault && <span className={styles.defaultBadge}>默认</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default List;
