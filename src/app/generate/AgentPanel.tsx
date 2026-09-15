"use client";

import { useState } from "react";
import { Button, ListBox, Select, TextArea, TextField } from "@heroui/react";
import { Icon } from "@iconify/react";
import UploadCard from "./UploadCard";
import styles from "./page.module.scss";

const modes = [
  { label: "生成", value: "generate", disabled: false },
  { label: "调整", value: "adjust", disabled: false },
  { label: "验证", value: "validate", disabled: false },
] as const;

/** 输入、模式与附件均保留在此组件内，隐藏卡片不会释放已选文件。 */
export default function AgentPanel() {
  const [mode, setMode] = useState<string>("generate");
  const [prompt, setPrompt] = useState("");
  const [reference, setReference] = useState<File | null>(null);
  const [blueprint, setBlueprint] = useState<File | null>(null);

  return (
    <aside className={styles.agentPanel} aria-labelledby="agent-title">
      <header className={styles.agentHeader}>
        <span className={styles.agentIcon}><Icon icon="tabler:sparkles" width={19} aria-hidden="true" /></span>
        <h2 id="agent-title">Agent</h2>
      </header>
      <div className={styles.messages} role="log" aria-label="Agent 对话消息" />
      <div className={styles.agentControls}>
        {mode === "generate" && (
          <div className={styles.uploadGrid}>
            <UploadCard title="参考文件" accept=".md,.html" formatLabel="MD / HTML" file={reference} onChange={setReference} />
            <UploadCard title="蓝图" accept=".json" formatLabel="JSON · 可选" file={blueprint} onChange={setBlueprint} />
          </div>
        )}
        <div className={styles.composer}>
          <TextField aria-label="Agent 消息" value={prompt} onChange={setPrompt} className={styles.promptField}>
            <TextArea className={styles.promptInput} rows={4} placeholder="输入你的要求…" />
          </TextField>
          <div className={styles.composerToolbar}>
            <Select aria-label="操作模式" value={mode} onChange={(value) => { if (value !== null) setMode(String(value)); }} className={styles.modeSelect}>
              <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
              <Select.Popover placement="top start">
                <ListBox aria-label="操作模式选项">
                  {modes.map((item) => (
                    <ListBox.Item key={item.value} id={item.value} textValue={item.label} isDisabled={item.disabled}>
                      {item.label}<ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            {/* 按钮无事件，输入框也不拦截 Enter，保留原生多行编辑行为。 */}
            <Button type="button" variant="primary" isIconOnly aria-label="发送" className={styles.sendButton}>
              <Icon icon="tabler:arrow-up" width={19} aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
