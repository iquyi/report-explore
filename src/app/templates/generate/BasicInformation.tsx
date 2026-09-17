"use client";

import { useState } from "react";
import { Button, Input, Label, TextField } from "@heroui/react";
import { updateTemplateField } from "../actions";
import { useAgentActions } from "./AgentActionContext";
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
  const { requestValidation, isAgentBusy } = useAgentActions();
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

  return (
    <div className={styles.basicInformation}>
      <div className={styles.metadataFields}>
        <TextField
          value={name}
          onChange={(value) => setName(value.slice(0, 50))}
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
          onChange={(value) => setDescription(value.slice(0, 500))}
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
          isDisabled={isAgentBusy}
          onPress={requestValidation}
        >
          验证
        </Button>
        <Button type="button" variant="primary">发布</Button>
      </div>
    </div>
  );
}
