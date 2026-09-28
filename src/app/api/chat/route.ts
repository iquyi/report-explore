import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessageStreamWriterWithOutcome,
} from "ai";
import { z } from "zod";
import { runReportWorkflow } from "@/lib/report-agent/workflow";
import type {
  ReportAgentUIMessage,
  ReportWorkflowResult,
} from "@/lib/report-agent/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  styleId: z.string().uuid().optional(),
  messages: z
    .array(
      z.looseObject({
        role: z.enum(["user", "assistant"]),
        parts: z.array(
          z.looseObject({ type: z.string(), text: z.string().max(20_000).optional() }),
        ),
      }),
    )
    .min(1)
    .max(10),
});

const getText = (message: z.infer<typeof requestSchema>["messages"][number]) =>
  message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();

/** Markdown 报告仅在审查与安全处理完成后分块写入，subagent 过程不会进入客户端消息。 */
const writeResult = (
  writer: UIMessageStreamWriterWithOutcome<ReportAgentUIMessage>,
  result: ReportWorkflowResult,
) => {
  if (result.outcome !== "report") {
    writer.write({ type: "data-result", data: result });
    return;
  }

  writer.write({ type: "data-result", data: { outcome: "report", title: result.title } });
  writer.write({ type: "data-report", data: { title: result.title } });
  const id = crypto.randomUUID();
  writer.write({ type: "text-start", id });
  for (let offset = 0; offset < result.markdown.length; offset += 8_192) {
    writer.write({
      type: "text-delta",
      id,
      delta: result.markdown.slice(offset, offset + 8_192),
    });
  }
  writer.write({ type: "text-end", id });
};

export async function POST(request: Request) {
  const stream = createUIMessageStream<ReportAgentUIMessage>({
    async execute({ writer }) {
      writer.write({ type: "start" });
      try {
        const parsed = requestSchema.safeParse(await request.json());
        if (!parsed.success) {
          writeResult(writer, {
            outcome: "error",
            message: "报告请求格式不正确，请刷新页面后重试。",
            retryable: false,
          });
          writer.write({ type: "finish", finishReason: "error" });
          return;
        }

        const conversation = parsed.data.messages
          .map((message) => ({ role: message.role, content: getText(message) }))
          .filter((message) => message.content.length > 0);
        const currentUserIndex = conversation.findLastIndex(
          (message) => message.role === "user",
        );
        if (currentUserIndex < 0) {
          writeResult(writer, {
            outcome: "error",
            message: "请输入报告需求。",
            retryable: false,
          });
          writer.write({ type: "finish", finishReason: "error" });
          return;
        }

        const result = await runReportWorkflow({
          userMessage: conversation[currentUserIndex].content,
          history: conversation.slice(0, currentUserIndex),
          styleId: parsed.data.styleId,
          abortSignal: request.signal,
          onStage(stage, label) {
            writer.write({ type: "data-status", data: { stage, label }, transient: true });
          },
        });
        writeResult(writer, result);
        writer.write({ type: "finish", finishReason: result.outcome === "error" ? "error" : "stop" });
      } catch (error) {
        if (request.signal.aborted) return;
        console.error("Report agent route failed.", error);
        writeResult(writer, {
          outcome: "error",
          message: "报告生成服务暂时不可用，请稍后重试。",
          retryable: true,
        });
        writer.write({ type: "finish", finishReason: "error" });
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}
