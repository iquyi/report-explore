import type { UIMessage } from "ai";
import type { TemplateVariable } from "@/app/templates/types";

export type TemplateAgentRoute = "generate" | "adjust" | "clarify";
export type TemplateContentState = "empty" | "partial" | "substantive";

/** Agent 只允许修改模板标准中的八个业务字段。 */
export type TemplateAgentContent = {
  name: string;
  description: string;
  variables: TemplateVariable[];
  explainStructure: string;
  consistencyRules: string;
  constraintRules: string;
  exceptionBoundaryRules: string;
  verificationRules: string;
};

export type TemplateAgentField = keyof TemplateAgentContent;

export type TemplateAgentAttachment = {
  name: string;
  mediaType: string;
  size: number;
  content: string;
};

export type TemplateAgentConfirmation = {
  action: "overwrite" | "adjust_without_attachment";
  revision: number;
  fingerprint: string;
  renameRequested: boolean;
};

export type TemplateValidationIssue = {
  field: TemplateAgentField | "template";
  reason: string;
  suggestion: string;
};

export type TemplateAgentResult =
  | {
      outcome: "needs_input";
      databaseUpdated: false;
      message: string;
      missingItems: string[];
    }
  | {
      outcome: "confirmation_required";
      databaseUpdated: false;
      message: string;
      confirmation: {
        kind: "overwrite" | "attachment_adjust";
        revision: number;
        fingerprint: string;
        renameRequested: boolean;
      };
    }
  | {
      outcome: "updated";
      databaseUpdated: true;
      message: string;
      revision: number;
      changedFields: TemplateAgentField[];
    }
  | {
      outcome: "validated";
      databaseUpdated: false;
      message: string;
      valid: boolean;
      issues: TemplateValidationIssue[];
    }
  | {
      outcome: "unchanged";
      databaseUpdated: false;
      message: string;
    }
  | {
      outcome: "error";
      databaseUpdated: false;
      message: string;
      retryable: boolean;
    };

export type TemplateAgentDataParts = {
  status: { stage: string; label: string };
  result: TemplateAgentResult;
};

/** UIMessage 只在当前页面存活，data parts 用于传递数据库结果和处理进度。 */
export type TemplateAgentUIMessage = UIMessage<
  unknown,
  TemplateAgentDataParts
>;
