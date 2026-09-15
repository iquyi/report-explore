"use client";

import { useState } from "react";
import { Button, Input, Label, TextField } from "@heroui/react";
import styles from "./page.module.scss";

/** 基本信息只在本组件内保存；字符上限是说明，不限制用户输入。 */
export default function BasicInformation() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  return (
    <div className={styles.basicInformation}>
      <div className={styles.metadataFields}>
        <TextField value={name} onChange={setName} className={styles.metadataField}>
          <div className={styles.labelRow}>
            <Label>模板名称</Label>
            <span className={styles.counter}>{Array.from(name).length} / 50 字符</span>
          </div>
          <Input className={styles.textInput} placeholder="为模板起一个名称" />
        </TextField>
        <TextField value={description} onChange={setDescription} className={styles.metadataField}>
          <div className={styles.labelRow}>
            <Label>用途描述</Label>
            <span className={styles.counter}>{Array.from(description).length} / 500 字符</span>
          </div>
          <Input className={styles.textInput} placeholder="描述模板的用途和适用场景" />
        </TextField>
      </div>
      {/* 普通按钮不属于表单，也不绑定事件，点击不会验证或提交。 */}
      <div className={styles.actions}>
        <Button type="button" variant="secondary">验证</Button>
        <Button type="button" variant="primary">提交</Button>
      </div>
    </div>
  );
}
