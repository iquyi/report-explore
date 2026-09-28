import type { Metadata } from "next";
import { queryStyles } from "../actions";
import StyleTable from "./StyleTable";

export const metadata: Metadata = {
  title: "设计风格管理 | Report Explore",
};

// 风格状态会直接影响下一次报告匹配，因此每次进入页面都读取数据库最新值。
export const dynamic = "force-dynamic";

export default async function StyleManagePage() {
  const result = await queryStyles();

  return (
    <StyleTable
      initialStyles={result.success ? result.data : []}
      loadError={result.success ? undefined : result.error}
    />
  );
}
