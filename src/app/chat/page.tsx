"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Icon } from "@iconify/react";
import Link from "next/link";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { DEMO_REPORT_PROMPTS } from "@/lib/report-demo";
import { tryParseReportMarkdown } from "@/lib/report-agent/report-markdown";
import type { ReportAgentUIMessage } from "@/lib/report-agent/types";
import type { ChatStyleOption } from "../styles/types";
import List from "./List";
import styles from "./page.module.scss";

const navigationItems = [
  { label: "模板管理", path: "/templates/manage" },
  { label: "设计风格管理", path: "/styles/manage" },
  { label: "数据维度管理", path: "" },
  { label: "更多", path: "" },
];

const getMessageText = (message: ReportAgentUIMessage) =>
  message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

const getDisplayText = (message: ReportAgentUIMessage) => {
  const text = getMessageText(message);
  if (text) return text;
  const result = message.parts.find((part) => part.type === "data-result");
  if (!result || result.data.outcome === "report") return "";
  if (result.data.outcome === "needs_input" && result.data.missingItems.length > 0) {
    return `${result.data.message}\n\n需要补充：\n${result.data.missingItems.map((item) => `- ${item}`).join("\n")}`;
  }
  return result.data.message;
};

/** 清理文件系统不允许的字符，避免报告标题直接作为下载文件名时产生兼容性问题。 */
const getReportFileName = (title: string) => `${title.replace(/[\\/:*?"<>|]/g, "-").trim() || "报告"}.html`;

/** 报告代码块外只渲染安全 Markdown；原始 HTML 和远程图片都不会进入页面。 */
const reportMarkdownComponents: Components = {
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
  ),
  img: ({ alt }) => <span>{alt ? `[图片：${alt}]` : "[图片已禁用]"}</span>,
};

function ReportMarkdownText({ value }: { value: string }) {
  if (!value.trim()) return null;
  return (
    <div className={styles.reportMarkdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={defaultUrlTransform}
        components={reportMarkdownComponents}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}

function ReportFrame({ html, title }: { html: string; title: string }) {
  const deferredHtml = useDeferredValue(html);
  const previewLinkRef = useRef<HTMLAnchorElement>(null);
  const downloadLinkRef = useRef<HTMLAnchorElement>(null);

  // Effect 每次执行都创建全新的 URL，并直接同步给操作链接，避免开发模式清理旧 URL 后继续复用。
  useEffect(() => {
    const nextPreviewUrl = URL.createObjectURL(
      new Blob([html], { type: "text/html;charset=utf-8" }),
    );
    const previewLink = previewLinkRef.current;
    const downloadLink = downloadLinkRef.current;
    previewLink?.setAttribute("href", nextPreviewUrl);
    downloadLink?.setAttribute("href", nextPreviewUrl);

    return () => {
      URL.revokeObjectURL(nextPreviewUrl);
      previewLink?.removeAttribute("href");
      downloadLink?.removeAttribute("href");
    };
  }, [html]);

  return (
    <article className={styles.reportCard} aria-label={`报告：${title}`}>
      <div className={styles.reportHeader}>
        <strong>{title}</strong>
        <div className={styles.reportActions}>
          <a ref={previewLinkRef} target="_blank" rel="noopener noreferrer">
            <Icon icon="tabler:external-link" width={17} aria-hidden="true" />
            新页面预览
          </a>
          {/* 两个操作复用同一有效 Blob URL，下载内容仍是解析并清洗后的纯 HTML。 */}
          <a
            ref={downloadLinkRef}
            className={styles.downloadButton}
            download={getReportFileName(title)}
            aria-label="下载报告"
            title="下载报告"
          >
            <Icon icon="tabler:download" width={18} aria-hidden="true" />
          </a>
        </div>
      </div>
      {/* 仅开放脚本以运行 ECharts；不开放同源、表单、弹窗和顶层导航能力。 */}
      <iframe className={styles.reportFrame} title={title} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={deferredHtml} />
    </article>
  );
}

/** 只有通过共享协议解析出的 HTML 才能进入 iframe，防止普通消息或裸 HTML 被执行。 */
function ReportMessage({ markdown, title, pending }: { markdown: string; title: string; pending: boolean }) {
  const report = tryParseReportMarkdown(markdown);
  if (report) {
    return (
      <>
        <ReportMarkdownText value={report.before} />
        <ReportFrame html={report.html} title={title} />
        <ReportMarkdownText value={report.after} />
      </>
    );
  }

  return (
    <p className={styles.reportFormatStatus} role={pending ? "status" : "alert"}>
      {pending ? "正在接收报告内容…" : "报告格式错误，无法预览。"}
    </p>
  );
}

export default function Chat() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [selectedStyle, setSelectedStyle] = useState<ChatStyleOption | null>(null);
  const [stage, setStage] = useState("");
  const [awaitingClarification, setAwaitingClarification] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(false);

  const transport = useMemo(
    () => new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages, body }) => ({
        // 普通新需求只发送最后一条用户消息；只有生成前澄清才带最近三条上下文。
        body: {
          ...(body ?? {}),
          messages: awaitingClarification ? messages.slice(-3) : messages.slice(-1),
        },
      }),
    }),
    [awaitingClarification],
  );

  const { messages, sendMessage, setMessages, status, stop } = useChat<ReportAgentUIMessage>({
    id: "report-chat",
    transport,
    onData(part) {
      if (part.type === "data-status") {
        setStage(part.data.label);
        return;
      }
      if (part.type !== "data-result") return;
      setAwaitingClarification(part.data.outcome === "needs_input");
      setStage("");
    },
    onFinish() {
      setStage("");
    },
    onError(error) {
      console.error("Report chat request failed.", error);
      setStage("报告生成失败，请稍后重试。");
    },
  });

  const running = status === "submitted" || status === "streaming";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, stage]);

  /** 手动输入和快捷选项共用同一发送入口，统一处理并发保护与输入清理。 */
  const sendPrompt = async (value: string) => {
    const text = value.trim();
    if (!text || running || submittingRef.current) return;
    // 先捕获本次请求的风格，再按交互约定立即清空输入框和 TAG。
    const submittedStyleId = selectedStyle?.id;
    submittingRef.current = true;
    setPrompt("");
    setSelectedStyle(null);
    try {
      await sendMessage(
        { text },
        submittedStyleId ? { body: { styleId: submittedStyleId } } : undefined,
      );
    } finally {
      // status 更新前的同步双击也会被 ref 拦截，请求结束后再允许下一次发送。
      submittingRef.current = false;
    }
  };

  const submit = () => sendPrompt(prompt);

  const newConversation = () => {
    if (running) stop();
    setAwaitingClarification(false);
    setStage("");
    setPrompt("");
    setSelectedStyle(null);
    submittingRef.current = false;
    setMessages([]);
  };

  return (
    <main className={styles.pageShell}>
      {sidebarOpen && (
        <aside className={styles.sidebar} aria-label="报告工作台侧边栏">
          <div className={styles.sidebarHeader}>
            <span className={styles.brandMark} aria-hidden="true" />
            <button className={styles.iconButton} type="button" aria-label="收起侧边栏" onClick={() => setSidebarOpen(false)}>
              <Icon icon="tabler:layout-sidebar-left-collapse" width={20} aria-hidden="true" />
            </button>
          </div>
          <button className={styles.createButton} type="button" onClick={newConversation}>
            <Icon className={styles.createIcon} icon="tabler:square-rounded-plus" width={18} aria-hidden="true" />
            新对话
          </button>
          <nav className={styles.navigation} aria-label="模板导航">
            {navigationItems.map((item) => (
              <Link href={item.path} key={item.label}>
                <span className={styles.navigationItem}>
                  {item.label === "更多" && <Icon className={styles.moreIcon} icon="tabler:dots" width={16} aria-hidden="true" />}
                  {item.label}
                </span>
              </Link>
            ))}
          </nav>
          <div className={styles.userArea}>
            <span className={styles.avatar} aria-hidden="true" />
            <span className={styles.userName}>用户昵称</span>
          </div>
        </aside>
      )}

      <section className={styles.workspace} aria-label="报告生成工作区">
        {!sidebarOpen && (
          <button className={styles.reopenButton} type="button" aria-label="展开侧边栏" onClick={() => setSidebarOpen(true)}>
            <Icon icon="tabler:layout-sidebar-left-expand" width={20} aria-hidden="true" />
          </button>
        )}
        <div className={styles.workspaceContent}>
          <section className={styles.composerSection}>
            <h1>Agent</h1>
            {messages.length > 0 && (
              <div className={styles.messages} aria-live="polite">
                {messages.map((message) => {
                  const text = getDisplayText(message);
                  const report = message.parts.find((part) => part.type === "data-report");
                  return (
                    <div key={message.id} className={message.role === "user" ? styles.userMessage : styles.assistantMessage}>
                      {message.role === "assistant" && report
                        ? <ReportMessage markdown={text} title={report.data.title} pending={running} />
                        : <p>{text}</p>}
                    </div>
                  );
                })}
                {stage && <p className={styles.stage}><Icon icon="tabler:loader-2" width={16} aria-hidden="true" />{stage}</p>}
                <div ref={messagesEndRef} />
              </div>
            )}
            <form className={styles.composerCard} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
              <div className={`${styles.promptArea} ${selectedStyle ? styles.promptAreaWithTag : ""}`}>
                {selectedStyle && (
                  <span className={styles.styleTag}>
                    <span>{selectedStyle.name}</span>
                    <button
                      type="button"
                      aria-label={`移除设计风格：${selectedStyle.name}`}
                      onClick={() => setSelectedStyle(null)}
                    >
                      <Icon icon="tabler:x" width={14} aria-hidden="true" />
                    </button>
                  </span>
                )}
                <textarea
                  value={prompt}
                  aria-label="报告需求"
                  placeholder="描述你希望生成的报告..."
                  disabled={running}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                />
                <button className={styles.sendButton} type="submit" aria-label="发送" disabled={!prompt.trim() || running}>
                  <Icon icon={running ? "tabler:loader-2" : "tabler:arrow-up"} width={20} aria-hidden="true" />
                </button>
              </div>
            </form>
            {messages.length === 0 && (
              <section className={styles.quickPrompts} aria-labelledby="quick-prompts-title">
                <h2 id="quick-prompts-title">演示报告</h2>
                <div className={styles.quickPromptList}>
                  {DEMO_REPORT_PROMPTS.map((item) => (
                    <button
                      className={styles.quickPromptButton}
                      type="button"
                      disabled={running}
                      key={item}
                      // 演示卡片只负责填充需求，交由用户检查并手动发送。
                      onClick={() => setPrompt(item)}
                    >
                      <Icon icon="tabler:sparkles" width={17} aria-hidden="true" />
                      <span>{item}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </section>
          {messages.length === 0 && (
            <List
              selectedStyle={selectedStyle}
              disabled={running}
              onSelectStyle={setSelectedStyle}
            />
          )}
        </div>
      </section>
    </main>
  );
}
