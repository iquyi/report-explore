import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // 报告模板 Agent 仍在 Node.js Route Handler 中读取两份根目录指南。
  // 设计风格已改为数据库读取，design-skill.md 只由数据库初始化脚本使用。
  outputFileTracingIncludes: {
    "/*": [
      "./generate-report-v2.md",
      "./adjust-report-v1.md",
      "./src/lib/data-source-mock/**/*",
    ],
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/chat", 
        permanent: false, // false = 307 临时重定向；true = 308 永久重定向
      },
    ];
  },
};

export default nextConfig;
