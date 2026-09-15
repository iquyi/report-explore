"use client";

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import styles from "./List.module.scss";

type TemplateItem = {
  id: string;
  name: string;
};

type TemplateGroup = {
  id: string;
  title: string;
  templates: TemplateItem[];
};

// 模板列表暂时使用本地 mock 数据，后续接入接口时可直接替换该数据源。
const templateGroups: TemplateGroup[] = [
  {
    id: "group-a",
    title: "分组 A",
    templates: Array.from({ length: 6 }, (_, index) => ({
      id: `template-a-${index + 1}`,
      name: `模板 A${index + 1}`,
    })),
  },
  {
    id: "group-b",
    title: "分组 B",
    templates: Array.from({ length: 3 }, (_, index) => ({
      id: `template-b-${index + 1}`,
      name: `模板 B${index + 1}`,
    })),
  },
];

const cardActions = [
  { label: "预览", icon: "tabler:eye" },
  { label: "修改", icon: "tabler:pencil" },
  { label: "Fork", icon: "tabler:git-fork" },
] as const;

const List = () => {
  // 保存待确认的模板；有值时展示删除确认弹窗。
  const [pendingDelete, setPendingDelete] = useState<TemplateItem | null>(null);

  const closeDeleteDialog = () => setPendingDelete(null);

  // 弹窗打开期间监听 Escape，保证不依赖鼠标也能快速关闭。
  useEffect(() => {
    if (!pendingDelete) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDeleteDialog();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingDelete]);

  return (
    <section className={styles.list} aria-label="模板列表">
      {templateGroups.map((group) => (
        <section
          className={styles.group}
          aria-labelledby={`${group.id}-title`}
          key={group.id}
        >
          <h2 className={styles.groupTitle} id={`${group.id}-title`}>
            {group.title}
          </h2>

          <div className={styles.grid}>
            {group.templates.map((template) => (
              <article className={styles.template} key={template.id}>
                {/* Cover 素材尚未提供，先保留固定尺寸的中性占位区域。 */}
                <div className={styles.cover}>
                  <button
                    className={styles.deleteButton}
                    type="button"
                    aria-label={`删除${template.name}`}
                    onClick={() => setPendingDelete(template)}
                  >
                    <Icon
                      icon="tabler:trash"
                      width={16}
                      height={16}
                      aria-hidden="true"
                    />
                  </button>

                  {/* 当前阶段仅提供操作入口的视觉与交互反馈，不接入业务行为。 */}
                  <div className={styles.cardActions}>
                    {cardActions.map((action) => (
                      <button type="button" key={action.label}>
                        <Icon
                          icon={action.icon}
                          width={15}
                          height={15}
                          aria-hidden="true"
                        />
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>

                <h3 className={styles.templateName}>{template.name}</h3>
              </article>
            ))}
          </div>
        </section>
      ))}

      {pendingDelete && (
        <div
          className={styles.dialogBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDeleteDialog();
          }}
        >
          <section
            className={styles.dialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            aria-describedby="delete-dialog-description"
          >
            <button
              className={styles.dialogClose}
              type="button"
              aria-label="关闭删除确认弹窗"
              onClick={closeDeleteDialog}
              autoFocus
            >
              <Icon
                icon="tabler:x"
                width={18}
                height={18}
                aria-hidden="true"
              />
            </button>

            <h2 id="delete-dialog-title">确认删除模板？</h2>
            <p id="delete-dialog-description">
              是否确认删除“{pendingDelete.name}”？
            </p>

            {/* Mock 阶段的确认操作只关闭弹窗，不修改列表数据。 */}
            <div className={styles.dialogActions}>
              <button type="button" onClick={closeDeleteDialog}>
                取消
              </button>
              <button
                className={styles.confirmButton}
                type="button"
                onClick={closeDeleteDialog}
              >
                确认删除
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
};

export default List;
