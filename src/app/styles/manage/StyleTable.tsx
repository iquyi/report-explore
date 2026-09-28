"use client";

import { useRef, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  ConfigProvider,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
} from "antd";
import type { TableProps } from "antd";
import zhCN from "antd/locale/zh_CN";
import {
  createStyle,
  deleteStyle,
  queryStyle,
  setDefaultStyle,
  setStyleStatus,
  updateStyle,
} from "../actions";
import type {
  StyleListItem,
  StyleMutationInput,
  StyleStatus,
} from "../types";
import styles from "./page.module.scss";

type StyleTableProps = {
  initialStyles: StyleListItem[];
  loadError?: string;
};

type DrawerState =
  | { mode: "create"; id: null }
  | { mode: "edit"; id: string }
  | null;

type PendingRowOperation = {
  id: string;
  kind: "delete" | "default" | "status";
};

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const parts = Object.fromEntries(
    dateTimeFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
};

const StyleTableContent = ({ initialStyles, loadError }: StyleTableProps) => {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<StyleMutationInput>();
  const submissionLocked = useRef(false);
  const detailRequestId = useRef(0);
  const [styleItems, setStyleItems] = useState(initialStyles);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingRowOperation, setPendingRowOperation] =
    useState<PendingRowOperation | null>(null);

  const hasPendingOperation =
    saving || detailLoading || pendingRowOperation !== null;

  const closeDrawer = () => {
    if (saving) return;
    detailRequestId.current += 1;
    setDetailLoading(false);
    setDrawer(null);
    form.resetFields();
  };

  const openCreateDrawer = () => {
    form.resetFields();
    setDrawer({ mode: "create", id: null });
  };

  /** 详情按需读取；请求序号防止快速切换时旧响应覆盖新抽屉。 */
  const openEditDrawer = async (id: string) => {
    const requestId = detailRequestId.current + 1;
    detailRequestId.current = requestId;
    form.resetFields();
    setDrawer({ mode: "edit", id });
    setDetailLoading(true);
    try {
      const result = await queryStyle(id);
      if (detailRequestId.current !== requestId) return;
      if (!result.success) {
        void message.error(result.error);
        setDrawer(null);
        return;
      }
      if (!result.data) {
        void message.error("设计风格不存在或已被删除。");
        setDrawer(null);
        return;
      }
      form.setFieldsValue({
        name: result.data.name,
        description: result.data.description,
        promptRules: result.data.promptRules,
      });
    } catch (error) {
      console.error("Failed to load style detail.", error);
      void message.error("设计风格详情加载失败，请稍后重试。");
      setDrawer(null);
    } finally {
      if (detailRequestId.current === requestId) setDetailLoading(false);
    }
  };

  const handleSave = async (input: StyleMutationInput) => {
    if (!drawer || saving || detailLoading || submissionLocked.current) return;
    submissionLocked.current = true;
    setSaving(true);
    try {
      const result = drawer.mode === "create"
        ? await createStyle(input)
        : await updateStyle(drawer.id, input);
      if (!result.success) {
        void message.error(result.error);
        return;
      }

      setStyleItems((current) =>
        drawer.mode === "create"
          ? [result.data, ...current]
          : current.map((item) =>
              item.id === result.data.id ? result.data : item,
            ),
      );
      void message.success(
        drawer.mode === "create" ? "设计风格已创建，当前为停用状态" : "设计风格已保存",
      );
      setDrawer(null);
      form.resetFields();
    } catch (error) {
      console.error("Failed to save style.", error);
      void message.error("设计风格保存失败，请稍后重试。");
    } finally {
      submissionLocked.current = false;
      setSaving(false);
    }
  };

  const handleStatusChange = async (
    style: StyleListItem,
    status: StyleStatus,
  ) => {
    if (hasPendingOperation) return;
    setPendingRowOperation({ id: style.id, kind: "status" });
    try {
      const result = await setStyleStatus(style.id, status);
      if (!result.success) {
        void message.error(result.error);
        return;
      }
      setStyleItems((current) =>
        current.map((item) =>
          item.id === style.id
            ? {
                ...item,
                status: result.data.status,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      );
      void message.success(status === 1 ? "设计风格已启用" : "设计风格已停用");
    } catch (error) {
      console.error("Failed to update style status.", error);
      void message.error("设计风格状态更新失败，请稍后重试。");
    } finally {
      setPendingRowOperation(null);
    }
  };

  const handleSetDefault = async (style: StyleListItem) => {
    if (hasPendingOperation || style.isDefault) return;
    setPendingRowOperation({ id: style.id, kind: "default" });
    try {
      const result = await setDefaultStyle(style.id);
      if (!result.success) {
        void message.error(result.error);
        return;
      }
      const updatedAt = new Date().toISOString();
      setStyleItems((current) =>
        current.map((item) => ({
          ...item,
          isDefault: item.id === result.data.id,
          status: item.id === result.data.id ? 1 : item.status,
          updatedAt:
            item.isDefault || item.id === result.data.id
              ? updatedAt
              : item.updatedAt,
        })),
      );
      void message.success(`“${style.name}”已设为默认风格`);
    } catch (error) {
      console.error("Failed to set default style.", error);
      void message.error("默认风格设置失败，请稍后重试。");
    } finally {
      setPendingRowOperation(null);
    }
  };

  const handleDelete = async (style: StyleListItem) => {
    if (hasPendingOperation || style.isDefault) return;
    setPendingRowOperation({ id: style.id, kind: "delete" });
    try {
      const result = await deleteStyle(style.id);
      if (!result.success) {
        void message.error(result.error);
        return;
      }
      setStyleItems((current) =>
        current.filter((item) => item.id !== result.data.id),
      );
      void message.success("设计风格已删除");
    } catch (error) {
      console.error("Failed to delete style.", error);
      void message.error("设计风格删除失败，请稍后重试。");
    } finally {
      setPendingRowOperation(null);
    }
  };

  const columns: TableProps<StyleListItem>["columns"] = [
    {
      title: "风格名称",
      dataIndex: "name",
      key: "name",
      width: 220,
      ellipsis: true,
    },
    {
      title: "用途描述",
      dataIndex: "description",
      key: "description",
      width: 420,
      ellipsis: { showTitle: false },
      render: (description: string) => (
        <Tooltip title={description}>
          <span className={styles.descriptionCell}>{description}</span>
        </Tooltip>
      ),
    },
    {
      title: "默认风格",
      dataIndex: "isDefault",
      key: "isDefault",
      width: 110,
      render: (isDefault: boolean) =>
        isDefault ? <Tag color="blue">默认</Tag> : "-",
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (_status, style) => {
        const loading =
          pendingRowOperation?.id === style.id &&
          pendingRowOperation.kind === "status";
        const control = (
          <Switch
            checked={style.status === 1}
            checkedChildren="启用"
            unCheckedChildren="停用"
            loading={loading}
            disabled={style.isDefault || (hasPendingOperation && !loading)}
            onChange={(checked) =>
              void handleStatusChange(style, checked ? 1 : 0)
            }
          />
        );
        return style.isDefault ? (
          <Tooltip title="默认风格不能停用，请先设置其他默认风格。">
            <span>{control}</span>
          </Tooltip>
        ) : control;
      },
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 180,
      render: (updatedAt: string) => formatDateTime(updatedAt),
    },
    {
      title: "操作",
      key: "actions",
      width: 250,
      fixed: "right",
      render: (_value, style) => {
        const settingDefault =
          pendingRowOperation?.id === style.id &&
          pendingRowOperation.kind === "default";
        const deleting =
          pendingRowOperation?.id === style.id &&
          pendingRowOperation.kind === "delete";

        return (
          <Space size="small">
            <Button
              type="link"
              disabled={hasPendingOperation}
              onClick={() => void openEditDrawer(style.id)}
            >
              编辑
            </Button>

            {style.isDefault ? (
              <Button type="link" disabled>当前默认</Button>
            ) : (
              <Popconfirm
                title="设为默认风格？"
                description={`“${style.name}”将自动启用，并替换当前默认风格。`}
                okText="确认"
                cancelText="取消"
                disabled={hasPendingOperation && !settingDefault}
                onConfirm={() => handleSetDefault(style)}
              >
                <Button
                  type="link"
                  loading={settingDefault}
                  disabled={hasPendingOperation && !settingDefault}
                >
                  设为默认
                </Button>
              </Popconfirm>
            )}

            <Tooltip title={style.isDefault ? "默认风格不能删除" : undefined}>
              <span>
                <Popconfirm
                  title="确认删除设计风格？"
                  description={`删除“${style.name}”后无法恢复。`}
                  okText="确认删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true, loading: deleting }}
                  disabled={style.isDefault || (hasPendingOperation && !deleting)}
                  onConfirm={() => handleDelete(style)}
                >
                  <Button
                    type="link"
                    danger
                    loading={deleting}
                    disabled={style.isDefault || (hasPendingOperation && !deleting)}
                  >
                    删除
                  </Button>
                </Popconfirm>
              </span>
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  return (
    <main className={styles.page}>
      <section className={styles.container} aria-labelledby="style-manage-title">
        <header className={styles.header}>
          <div>
            <h1 id="style-manage-title">设计风格管理</h1>
            <p>维护报告 HTML 可搭配使用的视觉设计规则。</p>
          </div>
          <Button
            type="primary"
            disabled={hasPendingOperation}
            onClick={openCreateDrawer}
          >
            创建
          </Button>
        </header>

        {loadError && (
          <Alert
            className={styles.loadError}
            type="error"
            showIcon
            title="设计风格加载失败"
            description={loadError}
          />
        )}

        <Table<StyleListItem>
          className={styles.table}
          rowKey="id"
          columns={columns}
          dataSource={styleItems}
          pagination={false}
          scroll={{ x: 1300 }}
          locale={{
            emptyText: loadError ? "暂时无法加载设计风格" : "暂无设计风格",
          }}
        />

        <Drawer
          open={drawer !== null}
          width={760}
          title={drawer?.mode === "edit" ? "编辑设计风格" : "创建设计风格"}
          destroyOnHidden
          closable={!saving}
          maskClosable={!saving}
          keyboard={!saving}
          onClose={closeDrawer}
          footer={
            <div className={styles.drawerFooter}>
              <Button disabled={saving} onClick={closeDrawer}>取消</Button>
              <Button
                type="primary"
                loading={saving}
                disabled={detailLoading}
                onClick={() => form.submit()}
              >
                保存
              </Button>
            </div>
          }
        >
          <Spin spinning={detailLoading} tip="正在加载设计风格…">
            <Form<StyleMutationInput>
              form={form}
              layout="vertical"
              requiredMark={false}
              disabled={detailLoading || saving}
              onFinish={(input) => void handleSave(input)}
            >
              <Form.Item
                name="name"
                label="风格名称"
                rules={[
                  { required: true, whitespace: true, message: "请输入风格名称" },
                  { max: 50, message: "风格名称不能超过 50 个字符" },
                ]}
              >
                <Input maxLength={50} showCount placeholder="例如：蓝色科技编辑风格" />
              </Form.Item>

              <Form.Item
                name="description"
                label="用途描述"
                rules={[
                  { required: true, whitespace: true, message: "请输入用途描述" },
                  { max: 500, message: "用途描述不能超过 500 个字符" },
                ]}
              >
                <Input.TextArea
                  autoSize={{ minRows: 3, maxRows: 6 }}
                  maxLength={500}
                  showCount
                  placeholder="说明该风格适用的报告类型、场景和视觉特征"
                />
              </Form.Item>

              <Form.Item
                name="promptRules"
                label="Prompt Rules"
                extra="规则只控制视觉风格与信息布局，不能覆盖报告模板、事实和安全约束。"
                rules={[
                  { required: true, whitespace: true, message: "请输入 Prompt Rules" },
                  { max: 50_000, message: "Prompt Rules 不能超过 50,000 个字符" },
                ]}
              >
                <Input.TextArea
                  className={styles.promptRulesInput}
                  autoSize={{ minRows: 20, maxRows: 30 }}
                  maxLength={50_000}
                  showCount
                  placeholder="输入类似 design-skill.md 的完整视觉规则"
                />
              </Form.Item>
            </Form>
          </Spin>
        </Drawer>
      </section>
    </main>
  );
};

const StyleTable = (props: StyleTableProps) => (
  <ConfigProvider locale={zhCN}>
    <AntdApp>
      <StyleTableContent {...props} />
    </AntdApp>
  </ConfigProvider>
);

export default StyleTable;
