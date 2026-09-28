export type StyleStatus = 0 | 1;

/** 列表只携带管理表格需要的轻量字段，完整 Prompt 在打开编辑抽屉时按需读取。 */
export type StyleListItem = {
  id: string;
  name: string;
  description: string;
  status: StyleStatus;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StyleDetail = StyleListItem & {
  promptRules: string;
};

/** 聊天页只需要展示和提交风格标识，不能把完整 Prompt Rules 发送到浏览器。 */
export type ChatStyleOption = Pick<
  StyleListItem,
  "id" | "name" | "description" | "isDefault"
>;

export type StyleMutationInput = {
  name: string;
  description: string;
  promptRules: string;
};

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };
