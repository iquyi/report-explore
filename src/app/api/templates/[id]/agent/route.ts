import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessageStreamWriterWithOutcome,
} from "ai";
import { z } from "zod";
import { runTemplateAgent } from "@/lib/template-agent/workflow";
import { TEMPLATE_FIELD_LABELS } from "@/lib/template-agent/schema";
import type {
  TemplateAgentResult,
  TemplateAgentUIMessage,
} from "@/lib/template-agent/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type AgentRouteProps = {
  params: Promise<{ id: string }>;
};

const textPartSchema = z.looseObject({
  type: z.string(),
  text: z.string().max(50_000).optional(),
});

const requestSchema = z.object({
  operation: z.enum(["chat", "validate"]).default("chat"),
  messages: z
    .array(
      z.looseObject({
        role: z.enum(["system", "user", "assistant"]),
        parts: z.array(textPartSchema),
      }),
    )
    .max(20),
  attachment: z
    .object({
      name: z.string().min(1).max(255),
      mediaType: z.string().min(1).max(100),
      size: z.number().int().positive().max(1024 * 1024),
      content: z.string().max(1024 * 1024),
    })
    .optional(),
  confirmation: z
    .object({
      action: z.enum(["overwrite", "adjust_without_attachment"]),
      revision: z.number().int().positive(),
      fingerprint: z.string().length(64),
      renameRequested: z.boolean(),
    })
    .optional(),
});

const getMessageText = (message: z.infer<typeof requestSchema>["messages"][number]) =>
  message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();

/** 只保留最近 20 条、最多 50,000 字符，避免页面长对话无限增大模型上下文。 */
const getConversation = (messages: z.infer<typeof requestSchema>["messages"]) => {
  const candidates = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: getMessageText(message),
    }))
    .filter((message) => message.content.length > 0)
    .slice(-20);

  const selected: typeof candidates = [];
  let length = 0;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const item = candidates[index];
    if (length + item.content.length > 50_000) break;
    selected.unshift(item);
    length += item.content.length;
  }
  return selected;
};

const formatAgentReply = (result: TemplateAgentResult): string => {
  if (result.outcome === "needs_input" && result.missingItems.length > 0) {
    return `${result.message}\n\n需要补充：\n${result.missingItems.map((item) => `- ${item}`).join("\n")}`;
  }

  if (result.outcome === "validated" && result.issues.length > 0) {
    return `${result.message}\n\n${result.issues
      .map(
        (issue) =>
          `- ${issue.field === "template" ? "整体模板" : TEMPLATE_FIELD_LABELS[issue.field]}：${issue.reason}\n  建议：${issue.suggestion}`,
      )
      .join("\n")}`;
  }

  return result.message;
};

const writeResult = (
  writer: UIMessageStreamWriterWithOutcome<TemplateAgentUIMessage>,
  result: TemplateAgentResult,
) => {
  const textId = crypto.randomUUID();
  writer.write({ type: "data-result", data: result });
  writer.write({ type: "text-start", id: textId });
  writer.write({ type: "text-delta", id: textId, delta: formatAgentReply(result) });
  writer.write({ type: "text-end", id: textId });
};

export async function POST(request: Request, { params }: AgentRouteProps) {
  const { id } = await params;
  const stream = createUIMessageStream<TemplateAgentUIMessage>({
    async execute({ writer }) {
      writer.write({ type: "start" });

      try {
        const parsed = requestSchema.safeParse(await request.json());
        if (!parsed.success) {
          writeResult(writer, {
            outcome: "error",
            databaseUpdated: false,
            message: "Agent 请求格式不正确，请刷新页面后重试。",
            retryable: false,
          });
          writer.write({ type: "finish", finishReason: "error" });
          return;
        }

        const conversation = getConversation(parsed.data.messages);
        // 确认请求不会新增用户消息，因此显式定位最后一条用户消息，
        // 并排除它之后的确认提示，避免把同一要求同时当作历史和当前输入。
        let currentUserIndex = -1;
        for (let index = conversation.length - 1; index >= 0; index -= 1) {
          if (conversation[index].role === "user") {
            currentUserIndex = index;
            break;
          }
        }
        const lastUserMessage = currentUserIndex >= 0
          ? conversation[currentUserIndex].content
          : "";

        const result = await runTemplateAgent({
          templateId: id,
          operation: parsed.data.operation,
          userMessage: lastUserMessage,
          history: conversation.slice(0, currentUserIndex),
          attachment: parsed.data.attachment,
          confirmation: parsed.data.confirmation,
          abortSignal: request.signal,
          onStage(stage, label) {
            writer.write({
              type: "data-status",
              data: { stage, label },
              transient: true,
            });
          },
        });

        writeResult(writer, result);
        writer.setOutcome({ status: "completed" });
        writer.write({ type: "finish", finishReason: "stop" });
      } catch (error) {
        // 浏览器主动停止后流已关闭，服务端不再补写错误消息；Workflow 的同一 signal 会阻止后续写库。
        if (request.signal.aborted) return;
        console.error("Failed to run template agent.", error);
        writeResult(writer, {
          outcome: "error",
          databaseUpdated: false,
          message: "Agent 处理失败，数据库没有被修改，请稍后重试。",
          retryable: true,
        });
        writer.write({ type: "finish", finishReason: "error" });
      }
    },
    onError(error) {
      console.error("Template agent stream failed.", error);
      return "Agent 响应流异常，请稍后重试。";
    },
  });

  return createUIMessageStreamResponse({ stream });
}
