"use client";

import { useState } from "react";
import { Icon } from "@iconify/react";
import styles from "./page.module.scss";
import List from "./List";
import Link from "next/link";

const navigationItems = [
  {
    label: "模板管理",
    path: "/templates/manage",
  },
  {
    label: "数据维度管理",
    path: "",
  },
  {
    label: "更多",
    path: "",
  },
];
const conversationItems: string[] = [];

const Chat = () => {
  // 侧边栏仅保留展开与完全隐藏两种状态，默认对应设计稿中的展开状态。
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <main className={styles.pageShell}>
      {sidebarOpen && (
        <aside className={styles.sidebar} aria-label="模板工作台侧边栏">
          {/* 顶部品牌占位与收起入口。设计稿没有真实品牌素材，因此使用同尺寸色块。 */}
          <div className={styles.sidebarHeader}>
            <span className={styles.brandMark} aria-hidden="true" />
            <button
              className={styles.iconButton}
              type="button"
              aria-label="收起侧边栏"
              aria-expanded="true"
              onClick={() => setSidebarOpen(false)}
            >
              <Icon
                icon="tabler:layout-sidebar-left-collapse"
                width={20}
                height={20}
                aria-hidden="true"
              />
            </button>
          </div>

          {/* 主入口和一级导航只展示设计稿中已有的静态项目。 */}
          <button className={styles.createButton} type="button">
            <Icon
              className={styles.createIcon}
              icon="tabler:square-rounded-plus"
              width={18}
              height={18}
              aria-hidden="true"
            />
            新对话
          </button>

          <nav className={styles.navigation} aria-label="模板导航">
            {navigationItems.map((item) => (
              <Link href={item.path} key={item.label}>
                <button className={styles.navigationItem} type="button">
                  {item.label === "更多" && (
                    <Icon
                      className={styles.moreIcon}
                      icon="tabler:dots"
                      width={16}
                      height={16}
                      aria-hidden="true"
                    />
                  )}
                  {item.label}
                </button>
              </Link>
            ))}
          </nav>

          {/* 对话记录为纯静态假数据，仅还原文本、截断和未读提示。 */}
          <section
            className={styles.conversations}
            aria-labelledby="conversation-title"
          >
            <h2 id="conversation-title">对话</h2>
            <div className={styles.conversationList}>
              {conversationItems.map((item, index) => (
                <button
                  className={styles.conversationItem}
                  type="button"
                  key={item}
                >
                  <span>{item}</span>
                  {index === conversationItems.length - 1 && (
                    <span className={styles.unreadDot} aria-label="未读" />
                  )}
                </button>
              ))}
            </div>
          </section>

          {/* 用户区固定在侧边栏底部，与长对话列表保持解耦。 */}
          <div className={styles.userArea}>
            <span className={styles.avatar} aria-hidden="true" />
            <span className={styles.userName}>用户昵称</span>
            <button
              className={styles.userMore}
              type="button"
              aria-label="更多用户操作"
            >
              <Icon
                icon="tabler:dots"
                width={16}
                height={16}
                aria-hidden="true"
              />
            </button>
          </div>
        </aside>
      )}

      <section className={styles.workspace} aria-label="创建模板工作区">
        {!sidebarOpen && (
          <button
            className={styles.reopenButton}
            type="button"
            aria-label="展开侧边栏"
            aria-expanded="false"
            onClick={() => setSidebarOpen(true)}
          >
            <Icon
              icon="tabler:layout-sidebar-left-expand"
              width={20}
              height={20}
              aria-hidden="true"
            />
          </button>
        )}

        {/* 创建区与模板列表共用内容列，由工作区统一承载纵向滚动。 */}
        <div className={styles.workspaceContent}>
          <div className={styles.composerSection}>
            <h1>Agent</h1>

            <div className={styles.composerCard}>
              <div className={styles.promptArea}>
                <textarea
                  aria-label="模板描述"
                  placeholder="即刻创建一个新模板..."
                />
                <button
                  className={styles.sendButton}
                  type="button"
                  aria-label="发送"
                >
                  <Icon
                    icon="tabler:arrow-up"
                    width={20}
                    height={20}
                    aria-hidden="true"
                  />
                </button>
              </div>

              {/* 底部按钮不接入文件或数据能力，仅保留设计稿中的视觉结构。 */}
              <div className={styles.composerTools}>
                <button type="button">
                  <Icon
                    className={styles.toolIcon}
                    icon="basil:file-upload-outline"
                    width={20}
                    height={20}
                    aria-hidden="true"
                  />
                  添加参考
                </button>
              </div>
            </div>
          </div>

          <List />
        </div>
      </section>
    </main>
  );
};

export default Chat;
