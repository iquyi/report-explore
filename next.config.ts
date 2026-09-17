import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // 完整模板生成在 Node.js Route Handler 中读取根目录提示词，显式加入部署追踪产物。
  outputFileTracingIncludes: {
    "/*": ["./generate-report-v2.md"],
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
