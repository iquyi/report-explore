import Link from "next/link";
import BasicInformation from "./BasicInformation";
import RuleFields from "./RuleFields";
import AgentPanel from "./AgentPanel";
import styles from "./page.module.scss";

/** 创建工作台仅组合前端编辑区域，不读取或创建模板记录。 */
export default function GeneratePage() {
  return (
    <main className={styles.page}>
      <section className={styles.editor} aria-labelledby="generate-title">
        <header className={styles.editorHeader}>
          <Link href="/templates/manage" className={styles.backLink}>
            返回模板管理
          </Link>
          <div className={styles.titleRow}>
            <h1 id="generate-title">创建模板</h1>
            <span className={styles.saveStatus}>未保存</span>
          </div>
          <BasicInformation />
        </header>
        <div className={styles.editorBody}>
          <RuleFields />
        </div>
      </section>
      <AgentPanel />
    </main>
  );
}
