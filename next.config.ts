import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
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
