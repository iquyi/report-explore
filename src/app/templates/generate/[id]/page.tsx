import Link from "next/link";
import { notFound } from "next/navigation";
import { Toast } from "@heroui/react";
import { queryTemplate } from "../../actions";
import AgentPanel from "../AgentPanel";
import { AgentActionProvider } from "../AgentActionContext";
import {
  AutoSaveStatus,
  AutoSaveStatusProvider,
} from "../AutoSaveStatus";
import BasicInformation from "../BasicInformation";
import RuleFields from "../RuleFields";
import styles from "../page.module.scss";

type GeneratePageProps = {
  params: Promise<{ id: string }>;
};

/** 动态工作台按 URL 中的模板 ID 读取草稿，并把可编辑字段注入本地表单。 */
export default async function GeneratePage({ params }: GeneratePageProps) {
  const { id } = await params;
  const result = await queryTemplate(id);

  if (!result.success) throw new Error(result.error);
  if (!result.data) notFound();

  const template = result.data;

  return (
    <AutoSaveStatusProvider>
      <AgentActionProvider>
        <main className={styles.page}>
          <section className={styles.editor} aria-labelledby="generate-title">
            <header className={styles.editorHeader}>
              <Link href="/templates/manage" className={styles.backLink}>
                返回模板管理
              </Link>
              <div className={styles.titleRow}>
                <h1 id="generate-title">编辑模板</h1>
                <AutoSaveStatus />
              </div>
              {/* Agent 更新 revision 后重建编辑器字段，确保展示数据库刚写入的版本。 */}
              <BasicInformation
                key={`${template.id}-${template.revision}`}
                templateId={template.id}
                initialName={template.name}
                initialDescription={template.description ?? ""}
              />
            </header>
            <div className={styles.editorBody}>
              <RuleFields
                key={`${template.id}-${template.revision}`}
                templateId={template.id}
                initialVariables={template.variables}
                initialValues={{
                  explain_structure: template.explainStructure ?? "",
                  consistency_rules: template.consistencyRules ?? "",
                  constraint_rules: template.constraintRules ?? "",
                  exception_boundary_rules:
                    template.exceptionBoundaryRules ?? "",
                  verification_rules: template.verificationRules ?? "",
                }}
              />
            </div>
          </section>
          <AgentPanel templateId={template.id} />
          <Toast.Provider placement="top end" />
        </main>
      </AgentActionProvider>
    </AutoSaveStatusProvider>
  );
}
