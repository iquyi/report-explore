"use client";

import { useRef, useState } from "react";
import {
  Button,
  FieldError,
  Input,
  Label,
  Modal,
  Popover,
  Tag,
  TagGroup,
  TextArea,
  TextField,
  Tooltip,
} from "@heroui/react";
import { Icon } from "@iconify/react";
import styles from "./page.module.scss";

type Variable = { id: string; name: string; definition: string };

/** 变量列表只保存已提交内容，弹窗草稿独立维护，取消不会修改列表。 */
export default function VariableFields() {
  const [variables, setVariables] = useState<Variable[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);

  // 编辑时排除当前记录；名称去除首尾空格后按大小写精确匹配。
  const nameError = !name.trim()
    ? "请输入变量名"
    : name.length > 20
      ? "变量名最多 20 字符"
      : variables.some(
            (item) => item.id !== editingId && item.name === name.trim(),
          )
        ? "变量名已存在"
        : "";
  const definitionError = !definition.trim()
    ? "请输入定义"
    : definition.length > 500
      ? "定义最多 500 字符"
      : "";

  function startEditing(variable?: Variable) {
    setEditingId(variable?.id ?? null);
    setName(variable?.name ?? "");
    setDefinition(variable?.definition ?? "");
    setSubmitted(false);
    setDeleteOpen(false);
    setOpen(true);
  }

  // 每次关闭都收起二次确认；下一次打开会重新初始化全部草稿。
  function close() {
    setDeleteOpen(false);
    setOpen(false);
  }

  function save() {
    setSubmitted(true);
    if (nameError || definitionError) return;
    const variable = {
      id: editingId ?? crypto.randomUUID(),
      name: name.trim(),
      definition,
    };
    setVariables((items) =>
      editingId
        ? items.map((item) => (item.id === editingId ? variable : item))
        : [...items, variable],
    );
    close();
  }

  function remove() {
    setVariables((items) => items.filter((item) => item.id !== editingId));
    close();
    // 被删除的标签无法恢复焦点，改为聚焦始终存在的添加按钮。
    requestAnimationFrame(() => addRef.current?.focus());
  }

  return (
    <section className={styles.variableField} aria-labelledby="variables-label">
      <div className={styles.ruleHeading}>
        <span className={styles.fieldNumber} aria-hidden="true">
          01
        </span>
        <h2 id="variables-label" className={styles.ruleLabel}>
          模板变量
        </h2>
        <span className={styles.fieldKey}>variables</span>
      </div>
      <p className={styles.fieldDescription}>
        定义报告生成时需要的输入信息、变量含义及变量之间的关系。
      </p>
      <div className={styles.variableList} aria-label="变量列表">
        {variables.length === 0 && (
          <span className={styles.emptyVariables}>
            暂无变量，点击下方按钮添加
          </span>
        )}
        {variables.map((variable) => (
          // 每个 TagGroup 仍以 Tag 作为直接集合项，同时允许 Tooltip 位于标签外层。
          <Tooltip key={variable.id} delay={0}>
            <Tooltip.Trigger className={styles.variableTooltipTrigger}>
              <TagGroup
                aria-label={`变量：${variable.name}`}
                onAction={() => startEditing(variable)}
              >
                <TagGroup.List className={styles.variableTagList}>
                  <Tag
                    id={variable.id}
                    textValue={variable.name}
                    className={styles.variableTag}
                  >
                    {variable.name}
                  </Tag>
                </TagGroup.List>
              </TagGroup>
            </Tooltip.Trigger>
            <Tooltip.Content className={styles.variableTooltip}>
              {variable.definition}
            </Tooltip.Content>
          </Tooltip>
        ))}
      </div>
      <div>
        <Button
          ref={addRef}
          type="button"
          variant="secondary"
          onPress={() => startEditing()}
        >
          <Icon icon="tabler:plus" width={16} aria-hidden="true" />
          添加变量
        </Button>
      </div>

      {/* 新增和编辑共用一个受控弹窗，避免两套表单校验行为不一致。 */}
      <Modal
        isOpen={open}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <Modal.Backdrop>
          <Modal.Container size="md">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>
                  {editingId ? "编辑变量" : "添加变量"}
                </Modal.Heading>
              </Modal.Header>
              {/* 原生长度限制与状态截断配合，保证粘贴等输入也不会保存超长内容。 */}
              <Modal.Body className={styles.variableForm}>
                <TextField
                  value={name}
                  onChange={(value) => setName(value.slice(0, 20))}
                  maxLength={20}
                  isRequired
                  isInvalid={submitted && !!nameError}
                >
                  <div className={styles.labelRow}>
                    <Label>变量名</Label>
                    <span className={styles.counter}>{name.length} / 20</span>
                  </div>
                  <Input autoFocus maxLength={20} placeholder="输入变量名" />
                  <FieldError>{nameError}</FieldError>
                </TextField>
                <TextField
                  value={definition}
                  onChange={(value) => setDefinition(value.slice(0, 500))}
                  maxLength={500}
                  isRequired
                  isInvalid={submitted && !!definitionError}
                >
                  <div className={styles.labelRow}>
                    <Label>定义</Label>
                    <span className={styles.counter}>
                      {definition.length} / 500
                    </span>
                  </div>
                  <TextArea
                    maxLength={500}
                    rows={6}
                    placeholder="输入变量的详细定义"
                  />
                  <FieldError>{definitionError}</FieldError>
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                {editingId && (
                  <Popover isOpen={deleteOpen} onOpenChange={setDeleteOpen}>
                    <Button
                      type="button"
                      variant="danger-soft"
                      className={styles.deleteVariable}
                    >
                      删除
                    </Button>
                    <Popover.Content placement="top start">
                      <Popover.Dialog>
                        <Popover.Heading>确认删除该变量？</Popover.Heading>
                        <div className={styles.deleteActions}>
                          <Button
                            type="button"
                            variant="secondary"
                            onPress={() => setDeleteOpen(false)}
                          >
                            取消
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            onPress={remove}
                          >
                            确认
                          </Button>
                        </div>
                      </Popover.Dialog>
                    </Popover.Content>
                  </Popover>
                )}
                <Button type="button" variant="secondary" onPress={close}>
                  取消
                </Button>
                <Button type="button" variant="primary" onPress={save}>
                  保存
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </section>
  );
}
