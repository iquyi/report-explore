"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Button, TextArea, TextField, toast } from "@heroui/react";
import { Icon } from "@iconify/react";
import type {
  TemplateAgentAttachment,
  TemplateAgentConfirmation,
  TemplateAgentResult,
  TemplateAgentUIMessage,
} from "@/lib/template-agent/types";
import { useAgentActions } from "./AgentActionContext";
import { useAutoSaveStatus } from "./AutoSaveStatus";
import UploadCard from "./UploadCard";
import styles from "./page.module.scss";

const MAX_ATTACHMENT_BYTES = 1024 * 1024;
const MAX_CONVERSATION_CHARACTERS = 50_000;
const VALIDATION_MESSAGE = "请验证当前数据库中的模板是否符合模板标准。";

type AgentPanelProps = {
  templateId: string;
};

type PendingConfirmation = Extract<
  TemplateAgentResult,
  { outcome: "confirmation_required" }
>["confirmation"];

const getText = (message: TemplateAgentUIMessage) =>
  message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");

/** 只把最近且在字符预算内的当前页消息发送给服务端，附件正文不属于消息 part。 */
const trimMessagesForRequest = (messages: TemplateAgentUIMessage[]) => {
  const selected: TemplateAgentUIMessage[] = [];
  let characters = 0;
  let currentUserIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      currentUserIndex = index;
      break;
    }
  }

  // 确认请求复用最后一条用户消息，不需要回传它之后的确认提示。
  for (let index = currentUserIndex; index >= 0; index -= 1) {
    if (selected.length === 20) break;
    const message = messages[index];
    const nextCharacters = characters + getText(message).length;
    if (nextCharacters > MAX_CONVERSATION_CHARACTERS) break;
    selected.unshift(message);
    characters = nextCharacters;
  }

  return selected;
};

const readAttachment = async (
  file: File | null,
): Promise<TemplateAgentAttachment | undefined> => {
  if (!file) return undefined;
  return {
    name: file.name,
    mediaType:
      file.type ||
      (file.name.endsWith(".html") ? "text/html" : "text/markdown"),
    size: file.size,
    content: await file.text(),
  };
};

/** 当前页面的消息由 useChat 管理；附件正文只放入本轮请求 body，不进入消息历史。 */
export default function AgentPanel({ templateId }: AgentPanelProps) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [reference, setReference] = useState<File | null>(null);
  const [stage, setStage] = useState("");
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation | null>(null);
  const pendingAttachmentRef = useRef<TemplateAgentAttachment | undefined>(
    undefined,
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastValidationRequestRef = useRef(0);
  const { waitUntilIdle } = useAutoSaveStatus();
  const { validationRequest, setAgentBusy } = useAgentActions();

  const transport = useMemo(
    () =>
      new DefaultChatTransport<TemplateAgentUIMessage>({
        api: `/api/templates/${templateId}/agent`,
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: {
            ...body,
            messages: trimMessagesForRequest(messages),
          },
        }),
      }),
    [templateId],
  );

  const { messages, sendMessage, status, stop } =
    useChat<TemplateAgentUIMessage>({
      id: `template-agent-${templateId}`,
      transport,
      onData(part) {
        if (part.type === "data-status") {
          setStage(part.data.label);
          return;
        }
        if (part.type !== "data-result") return;

        const result = part.data;
        setStage("");
        if (result.outcome === "confirmation_required") {
          setPendingConfirmation(result.confirmation);
          return;
        }
        // 普通请求结束后不把附件正文带入下一轮；确认分支例外，因为覆盖执行仍需原附件。
        if (pendingAttachmentRef.current) {
          pendingAttachmentRef.current = undefined;
          setReference(null);
        }
        if (result.outcome === "updated") {
          setPendingConfirmation(null);
          router.refresh();
        }
      },
      onFinish() {
        setStage("");
      },
      onError(error) {
        console.error("Template agent request failed.", error);
        setStage("");
        toast.danger("Agent 请求失败，请稍后重试。");
      },
    });

  const running = status === "submitted" || status === "streaming";

  useEffect(() => {
    setAgentBusy(running || pendingConfirmation !== null);
    return () => setAgentBusy(false);
  }, [pendingConfirmation, running, setAgentBusy]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, stage, pendingConfirmation]);

  /** 点击 Agent 前先让当前编辑控件失焦，并等待由失焦触发的自动保存完成。 */
  const flushEditorSaves = useCallback(async () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await waitUntilIdle();
  }, [waitUntilIdle]);

  const submitValidation = useCallback(async () => {
    if (running || pendingConfirmation) return;
    await flushEditorSaves();
    await sendMessage(
      { text: VALIDATION_MESSAGE },
      { body: { operation: "validate" } },
    );
  }, [flushEditorSaves, pendingConfirmation, running, sendMessage]);

  useEffect(() => {
    if (
      validationRequest === 0 ||
      validationRequest === lastValidationRequestRef.current
    ) {
      return;
    }
    lastValidationRequestRef.current = validationRequest;
    void submitValidation();
  }, [submitValidation, validationRequest]);

  const submitPrompt = useCallback(async () => {
    const text = prompt.trim();
    if (running || pendingConfirmation) return;
    if (!text && !reference) {
      toast.warning("请输入要求或上传参考文件。");
      return;
    }
    if (reference && reference.size > MAX_ATTACHMENT_BYTES) {
      toast.danger("参考文件不能超过 1 MiB。");
      return;
    }

    await flushEditorSaves();
    const attachment = await readAttachment(reference);
    pendingAttachmentRef.current = attachment;
    const visibleText = [
      text || "请根据参考文件生成模板。",
      attachment ? `附件：${attachment.name}（${attachment.size} B）` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    if (visibleText.length > MAX_CONVERSATION_CHARACTERS) {
      toast.danger("单次要求不能超过 50,000 个字符。");
      return;
    }

    setPrompt("");
    await sendMessage(
      { text: visibleText },
      { body: { operation: "chat", attachment } },
    );
  }, [
    flushEditorSaves,
    pendingConfirmation,
    prompt,
    reference,
    running,
    sendMessage,
  ]);

  const submitConfirmation = useCallback(
    async (action: TemplateAgentConfirmation["action"]) => {
      if (!pendingConfirmation || running) return;
      const confirmation: TemplateAgentConfirmation = {
        action,
        revision: pendingConfirmation.revision,
        fingerprint: pendingConfirmation.fingerprint,
        renameRequested: pendingConfirmation.renameRequested,
      };
      const attachment = pendingAttachmentRef.current;
      setPendingConfirmation(null);
      if (action === "adjust_without_attachment") {
        pendingAttachmentRef.current = undefined;
        setReference(null);
      }
      await flushEditorSaves();
      await sendMessage(undefined, {
        body: {
          operation: "chat",
          attachment,
          confirmation,
        },
      });
    },
    [flushEditorSaves, pendingConfirmation, running, sendMessage],
  );

  return (
    <aside className={styles.agentPanel} aria-labelledby="agent-title">
      <header className={styles.agentHeader}>
        <span className={styles.agentIcon}>
          <Icon icon="tabler:sparkles" width={19} aria-hidden="true" />
        </span>
        <div>
          <h2 id="agent-title">模板 Agent</h2>
          <p>自动判断生成、调整或追问</p>
        </div>
      </header>

      <div className={styles.messages} role="log" aria-label="Agent 对话消息">
        {messages.length === 0 && (
          <div className={styles.emptyMessages}>
            描述模板需求，或上传 MD / HTML 参考文件。
          </div>
        )}
        {messages.map((message) => {
          const text = getText(message);
          if (!text) return null;
          return (
            <article
              key={message.id}
              className={`${styles.message} ${
                message.role === "user"
                  ? styles.userMessage
                  : styles.agentMessage
              }`}
            >
              <span>{message.role === "user" ? "你" : "Agent"}</span>
              <p>{text}</p>
            </article>
          );
        })}
        {running && (
          <div className={`${styles.message} ${styles.agentMessage}`}>
            <span>Agent</span>
            <p className={styles.stageMessage}>
              <Icon icon="tabler:loader-2" width={15} aria-hidden="true" />
              {stage || "正在处理…"}
            </p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className={styles.agentControls}>
        {pendingConfirmation && (
          <section className={styles.confirmationCard} aria-live="polite">
            <div className={styles.confirmationTitle}>
              <Icon
                icon="tabler:alert-triangle"
                width={17}
                aria-hidden="true"
              />
              <strong>需要确认</strong>
            </div>
            <p>
              {pendingConfirmation.kind === "overwrite"
                ? "当前模板已有内容，重新生成可能覆盖现有模板。"
                : "附件只能用于完整生成，不能直接参与局部调整。"}
            </p>
            <div className={styles.confirmationOptions}>
              <Button
                type="button"
                variant="primary"
                onPress={() => void submitConfirmation("overwrite")}
              >
                重新生成并覆盖
              </Button>
              <Button
                type="button"
                variant="secondary"
                onPress={() => {
                  if (pendingConfirmation.kind === "overwrite") {
                    pendingAttachmentRef.current = undefined;
                    setPendingConfirmation(null);
                    setReference(null);
                    toast.info("请在输入框中描述需要局部调整的内容。");
                    return;
                  }
                  void submitConfirmation("adjust_without_attachment");
                }}
              >
                {pendingConfirmation.kind === "overwrite"
                  ? "改为局部调整"
                  : "忽略附件并调整"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onPress={() => {
                  pendingAttachmentRef.current = undefined;
                  setPendingConfirmation(null);
                }}
              >
                取消
              </Button>
            </div>
          </section>
        )}

        <div className={styles.uploadGrid}>
          <UploadCard
            title="参考文件"
            accept=".md,.html"
            formatLabel="MD / HTML · 最大 1 MiB"
            file={reference}
            onChange={(file) => {
              if (file && file.size > MAX_ATTACHMENT_BYTES) {
                toast.danger("参考文件不能超过 1 MiB。");
                return;
              }
              setReference(file);
            }}
          />
        </div>

        <div className={styles.composer}>
          <TextField
            aria-label="Agent 消息"
            value={prompt}
            onChange={setPrompt}
            className={styles.promptField}
            isDisabled={pendingConfirmation !== null}
          >
            <TextArea
              className={styles.promptInput}
              rows={4}
              placeholder="描述要生成或调整的内容…"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submitPrompt();
                }
              }}
            />
          </TextField>
          <div className={styles.composerToolbar}>
            <span className={styles.routingHint}>Agent 自动判断操作路径</span>
            <Button
              type="button"
              variant="primary"
              isIconOnly
              aria-label={running ? "停止" : "发送"}
              className={styles.sendButton}
              onPress={() => {
                if (running) void stop();
                else void submitPrompt();
              }}
              isDisabled={pendingConfirmation !== null}
            >
              <Icon
                icon={running ? "tabler:square-filled" : "tabler:arrow-up"}
                width={running ? 14 : 19}
                aria-hidden="true"
              />
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
