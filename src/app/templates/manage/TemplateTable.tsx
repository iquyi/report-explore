"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  App as AntdApp,
  Button,
  ConfigProvider,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
} from "antd";
import type { TableProps } from "antd";
import zhCN from "antd/locale/zh_CN";
import { createTemplate, deleteTemplate, setTemplateStatus } from "../actions";
import type {
  CreateTemplateInput,
  TemplateListItem,
  TemplateStatus,
} from "../types";
import styles from "./page.module.scss";

type TemplateTableProps = {
  initialTemplates: TemplateListItem[];
  loadError?: string;
};

type PendingOperation = {
  id: string;
  kind: "delete" | "status";
};

/** 固定使用北京时间格式，避免服务端和浏览器时区不同造成展示差异。 */
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

const formatCreatedAt = (value: string): string => {
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

const TemplateTableContent = ({
  initialTemplates,
  loadError,
}: TemplateTableProps) => {
  const { message } = AntdApp.useApp();
  const router = useRouter();
  const [createForm] = Form.useForm<CreateTemplateInput>();
  const [templates, setTemplates] = useState(initialTemplates);
  const [pendingOperation, setPendingOperation] =
    useState<PendingOperation | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const hasPendingOperation = pendingOperation !== null || creating;

  /** 创建成功后直接进入该草稿的动态编辑页，失败则保留用户输入以便重试。 */
  const handleCreate = async (input: CreateTemplateInput) => {
    if (creating || pendingOperation) return;

    setCreating(true);
    try {
      const result = await createTemplate(input);
      if (!result.success) {
        void message.error(result.error);
        return;
      }

      router.push(`/templates/generate/${result.data.id}`);
    } catch (error) {
      console.error("Failed to create template draft.", error);
      void message.error("模板创建失败，请稍后重试。");
    } finally {
      setCreating(false);
    }
  };

  /** 成功后同步本地行数据；服务端 Action 同时刷新路由缓存。 */
  const handleStatusChange = async (
    template: TemplateListItem,
    status: TemplateStatus,
  ) => {
    if (hasPendingOperation) return;

    setPendingOperation({ id: template.id, kind: "status" });
    try {
      const result = await setTemplateStatus(template.id, status);
      if (!result.success) {
        void message.error(result.error);
        return;
      }

      setTemplates((current) =>
        current.map((item) =>
          item.id === template.id
            ? { ...item, status: result.data.status }
            : item,
        ),
      );
      void message.success(status === 1 ? "模板已启用" : "模板已停用");
    } catch (error) {
      console.error("Failed to submit template status.", error);
      void message.error("模板状态更新失败，请稍后重试。");
    } finally {
      setPendingOperation(null);
    }
  };

  /** Popconfirm 只在用户确认后调用该处理函数，取消不会修改列表。 */
  const handleDelete = async (template: TemplateListItem) => {
    if (hasPendingOperation) return;

    setPendingOperation({ id: template.id, kind: "delete" });
    try {
      const result = await deleteTemplate(template.id);
      if (!result.success) {
        void message.error(result.error);
        return;
      }

      setTemplates((current) =>
        current.filter((item) => item.id !== template.id),
      );
      void message.success("模板已删除");
    } catch (error) {
      console.error("Failed to submit template deletion.", error);
      void message.error("模板删除失败，请稍后重试。");
    } finally {
      setPendingDeleteId(null);
      setPendingOperation(null);
    }
  };

  const columns: TableProps<TemplateListItem>["columns"] = [
    {
      title: "模板名称",
      dataIndex: "name",
      key: "name",
      width: 180,
      ellipsis: true,
    },
    {
      title: "用途描述",
      dataIndex: "description",
      key: "description",
      width: 360,
      ellipsis: { showTitle: false },
      render: (description: string | null) => {
        const text = description?.trim() || "-";

        return (
          <Tooltip title={description || undefined}>
            <span className={styles.descriptionCell}>{text}</span>
          </Tooltip>
        );
      },
    },
    {
      title: "类型",
      dataIndex: "type",
      key: "type",
      width: 110,
      render: (type: TemplateListItem["type"]) => <Tag>{type}</Tag>,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (_status, template) => {
        // 草稿尚未进入启停流程，状态列仅展示草稿标识。
        if (template.isDraft === 1) return "草稿";

        const loading =
          pendingOperation?.id === template.id &&
          pendingOperation.kind === "status";

        return (
          <Switch
            checked={template.status === 1}
            checkedChildren="启用"
            unCheckedChildren="停用"
            loading={loading}
            disabled={hasPendingOperation && !loading}
            onChange={(checked) =>
              void handleStatusChange(template, checked ? 1 : 0)
            }
          />
        );
      },
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (createdAt: string) => formatCreatedAt(createdAt),
    },
    {
      title: "操作",
      key: "actions",
      width: 150,
      fixed: "right",
      render: (_value, template) => {
        const deleting =
          pendingOperation?.id === template.id &&
          pendingOperation.kind === "delete";

        return (
          <Space size="small">
            <Button
              type="link"
              href={`/templates/generate/${template.id}`}
              disabled={hasPendingOperation}
            >
              修改
            </Button>

            <Popconfirm
              open={pendingDeleteId === template.id}
              title="确认删除模板？"
              description={`删除“${template.name}”后无法恢复。`}
              okText="确认删除"
              cancelText="取消"
              okButtonProps={{ danger: true, loading: deleting }}
              disabled={hasPendingOperation && !deleting}
              onConfirm={() => handleDelete(template)}
              onOpenChange={(open) => {
                // 删除执行期间锁定当前弹窗，防止切换到其他模板。
                if (hasPendingOperation) return;
                setPendingDeleteId(open ? template.id : null);
              }}
            >
              <Button
                type="link"
                danger
                loading={deleting}
                disabled={hasPendingOperation && !deleting}
                onClick={() => {
                  if (!hasPendingOperation) setPendingDeleteId(template.id);
                }}
              >
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <main className={styles.page}>
      <section
        className={styles.container}
        aria-labelledby="template-manage-title"
      >
        <header className={styles.header}>
          <div>
            <h1 id="template-manage-title">模板管理</h1>
          </div>

          <Button
            type="primary"
            disabled={hasPendingOperation}
            onClick={() => {
              createForm.resetFields();
              setCreateOpen(true);
            }}
          >
            创建
          </Button>
        </header>

        {loadError && (
          <Alert
            className={styles.loadError}
            type="error"
            showIcon
            title="模板加载失败"
            description={loadError}
          />
        )}

        <Table<TemplateListItem>
          className={styles.table}
          rowKey="id"
          columns={columns}
          dataSource={templates}
          pagination={false}
          scroll={{ x: 1100 }}
          locale={{ emptyText: loadError ? "暂时无法加载模板" : "暂无模板数据" }}
        />

        {/* 弹框只收集创建草稿必需的名称，其他内容进入编辑页后再填写。 */}
        <Modal
          open={createOpen}
          title="创建模板"
          okText="提交"
          cancelText="取消"
          confirmLoading={creating}
          cancelButtonProps={{ disabled: creating }}
          closable={!creating}
          mask={{ closable: !creating }}
          keyboard={!creating}
          onOk={() => createForm.submit()}
          onCancel={() => {
            if (!creating) setCreateOpen(false);
          }}
          afterClose={() => createForm.resetFields()}
        >
          <Form<CreateTemplateInput>
            form={createForm}
            layout="vertical"
            requiredMark={false}
            onFinish={(input) => void handleCreate(input)}
          >
            <Form.Item
              name="name"
              label="模板名称"
              rules={[
                { required: true, whitespace: true, message: "请输入模板名称" },
                { max: 50, message: "模板名称不能超过 50 个字符" },
              ]}
            >
              <Input
                autoFocus
                maxLength={50}
                showCount
                placeholder="请输入模板名称"
                disabled={creating}
              />
            </Form.Item>
          </Form>
        </Modal>
      </section>
    </main>
  );
};

/** 提供 Ant Design 中文文案和 message 上下文。 */
const TemplateTable = (props: TemplateTableProps) => (
  <ConfigProvider locale={zhCN}>
    <AntdApp>
      <TemplateTableContent {...props} />
    </AntdApp>
  </ConfigProvider>
);

export default TemplateTable;
