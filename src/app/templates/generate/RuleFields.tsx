"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Label, TextArea, TextField } from "@heroui/react";
import { updateTemplateField } from "../actions";
import type { TemplateTextEditableField, TemplateVariable } from "../types";
import useAutoSaveField from "./useAutoSaveField";
import styles from "./page.module.scss";
import VariableFields from "./VariableFields";

/** 展示配置集中维护语义与长度说明，不包含校验或服务字段映射。 */
const fields = [
  { key: "explain_structure", actionField: "explainStructure", label: "报告结构", description: "描述报告各模块的内容职责，以及组件的数据字段、数量和排序要求。", limit: 10000 },
  { key: "consistency_rules", actionField: "consistencyRules", label: "一致性规则", description: "定义跨模块需要保持一致的名称、数据口径、引用关系和排序规则。", limit: 1000 },
  { key: "constraint_rules", actionField: "constraintRules", label: "核心约束", description: "定义报告生成时必须遵守的业务要求和不可违反的限制。", limit: 1000 },
  { key: "exception_boundary_rules", actionField: "exceptionBoundaryRules", label: "异常边界处理", description: "定义信息缺失、数据冲突、条件不适用等异常情况的处理方式。", limit: 1000 },
  { key: "verification_rules", actionField: "verificationRules", label: "交付校验规则", description: "定义报告完成后需要检查的内容、依据及交付要求。", limit: 1000 },
] as const;

type RuleFieldKey = (typeof fields)[number]["key"];

type RuleFieldsProps = {
  templateId: string;
  initialVariables: TemplateVariable[];
  initialValues: Record<RuleFieldKey, string>;
};

const serializeText = (value: string) => value;

function RuleField({
  field,
  initialValue,
  templateId,
}: {
  field: (typeof fields)[number];
  initialValue: string;
  templateId: string;
}) {
  const [value, setValue] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { saveIfChanged } = useAutoSaveField({
    initialValue,
    serialize: serializeText,
    save: (nextValue) =>
      updateTemplateField(templateId, {
        field: field.actionField as TemplateTextEditableField,
        value: nextValue,
      }),
  });

  // 先重置高度再测量内容，既支持输入增高，也支持删除后的回缩。
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight + 2}px`;
    };
    resize();

    // 容器变窄会增加换行数；只监听宽度变化，避免高度更新形成观察循环。
    let previousWidth = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth !== previousWidth) {
        previousWidth = textarea.clientWidth;
        resize();
      }
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [value]);

  return (
    <TextField
      value={value}
      onChange={(nextValue) => setValue(nextValue.slice(0, field.limit))}
      className={styles.ruleField}
    >
      <div className={styles.ruleHeading}>
        <Label className={styles.ruleLabel}>{field.label}</Label>
      </div>
      <p id={`${field.key}-description`} className={styles.fieldDescription}>{field.description}</p>
      <TextArea
        ref={textareaRef}
        rows={4}
        maxLength={field.limit}
        className={styles.ruleTextarea}
        aria-describedby={`${field.key}-description ${field.key}-count`}
        placeholder={`输入${field.label}…`}
        onBlur={() => saveIfChanged(value)}
      />
      <span id={`${field.key}-count`} className={styles.counter}>
        {Array.from(value).length.toLocaleString("en-US")} / {field.limit.toLocaleString("en-US")} 字符
      </span>
    </TextField>
  );
}

/** 每个字段独立保存输入，编辑单项时不重绘整份长模板。 */
export default function RuleFields({
  templateId,
  initialVariables,
  initialValues,
}: RuleFieldsProps) {
  return (
    <div className={styles.ruleFields}>
      <VariableFields
        templateId={templateId}
        initialValue={initialVariables}
      />
      {fields.map((field) => (
        <RuleField
          key={field.key}
          field={field}
          initialValue={initialValues[field.key]}
          templateId={templateId}
        />
      ))}
    </div>
  );
}
