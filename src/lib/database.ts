import { neon } from "@neondatabase/serverless";

type DatabaseClient = ReturnType<typeof neon>;

let databaseClient: DatabaseClient | undefined;

/**
 * 延迟创建 Neon 客户端，避免仅导入模块时就读取数据库连接配置。
 * 开发环境优先使用非池化地址，与现有数据库初始化脚本保持一致。
 */
export const getDatabase = (): DatabaseClient => {
  if (databaseClient) return databaseClient;

  const connectionString =
    process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("Missing DATABASE_URL_UNPOOLED or DATABASE_URL.");
  }

  databaseClient = neon(connectionString);
  return databaseClient;
};
