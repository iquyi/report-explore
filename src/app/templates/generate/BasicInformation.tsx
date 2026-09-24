"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, TextField, toast } from "@heroui/react";
import { publishTemplate, updateTemplateField } from "../actions";
import { useAgentActions } from "./AgentActionContext";
import { useAutoSaveStatus } from "./AutoSaveStatus";
import useAutoSaveField from "./useAutoSaveField";
import styles from "./page.module.scss";

type BasicInformationProps = {
  templateId: string;
  initialName: string;
  initialDescription: string;
};

const serializeText = (value: string) => value;

/** 查询结果只作为初始状态，后续输入仍由当前编辑组件独立维护。 */
export default function BasicInformation({
  templateId,
  initialName,
  initialDescription,
}: BasicInformationProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [publishing, setPublishing] = useState(false);
  const router = useRouter();
  const {
    requestValidation,
    isAgentBusy,
    validationState,
    validatedRevision,
    markValidationStale,
    clearValidation,
  } = useAgentActions();
  const { pendingCount, waitUntilIdle } = useAutoSaveStatus();
  const { saveIfChanged: saveNameIfChanged } = useAutoSaveField({
    initialValue: initialName,
    serialize: serializeText,
    save: (value) =>
      updateTemplateField(templateId, { field: "name", value }),
  });
  const { saveIfChanged: saveDescriptionIfChanged } = useAutoSaveField({
    initialValue: initialDescription,
    serialize: serializeText,
    save: (value) =>
      updateTemplateField(templateId, { field: "description", value }),
  });

  const publish = async () => {
    if (validationState !== "passed" || validatedRevision === null) return;
    setPublishing(true);
    await waitUntilIdle();
    const result = await publishTemplate(templateId, validatedRevision);
    setPublishing(false);
    if (!result.success) {
      toast.danger(result.error);
      return;
    }
    clearValidation();
    toast.success("模板已发布并启用。");
    router.refresh();
  };

  return (
    <div className={styles.basicInformation}>
      <div className={styles.metadataFields}>
        <TextField
          value={name}
          onChange={(value) => {
            markValidationStale();
            setName(value.slice(0, 50));
          }}
          className={styles.metadataField}
        >
          <div className={styles.labelRow}>
            <Label>模板名称</Label>
            <span className={styles.counter}>
              {Array.from(name).length} / 50 字符
            </span>
          </div>
          <Input
            className={styles.textInput}
            maxLength={50}
            placeholder="为模板起一个名称"
            onBlur={() => {
              const trimmedName = name.trim();
              setName(trimmedName);
              saveNameIfChanged(trimmedName);
            }}
          />
        </TextField>
        <TextField
          value={description}
          onChange={(value) => {
            markValidationStale();
            setDescription(value.slice(0, 500));
          }}
          className={styles.metadataField}
        >
          <div className={styles.labelRow}>
            <Label>用途描述</Label>
            <span className={styles.counter}>
              {Array.from(description).length} / 500 字符
            </span>
          </div>
          <Input
            className={styles.textInput}
            maxLength={500}
            placeholder="描述模板的用途和适用场景"
            onBlur={() => saveDescriptionIfChanged(description)}
          />
        </TextField>
      </div>
      <div className={styles.actions}>
        <Button
          type="button"
          variant="secondary"
          isDisabled={isAgentBusy || validationState === "validating" || pendingCount > 0}
          onPress={requestValidation}
        >
          {validationState === "validating" ? "验证中…" : "验证"}
        </Button>
        <Button
          type="button"
          variant="primary"
          isDisabled={validationState !== "passed" || pendingCount > 0 || isAgentBusy || publishing}
          onPress={() => void publish()}
        >
          {publishing ? "发布中…" : "发布"}
        </Button>
      </div>
    </div>
  );
}
