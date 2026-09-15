import type { Metadata } from "next";
import { queryTemplates } from "../actions";
import TemplateTable from "./TemplateTable";

export const metadata: Metadata = {
  title: "模板管理 | Report Explore",
};

// 模板数据来自数据库，每次进入页面都应读取当前状态，不在构建阶段固化结果。
export const dynamic = "force-dynamic";

const TemplateManagePage = async () => {
  const result = await queryTemplates();

  return (
    <TemplateTable
      initialTemplates={result.success ? result.data : []}
      loadError={result.success ? undefined : result.error}
    />
  );
};

export default TemplateManagePage;
