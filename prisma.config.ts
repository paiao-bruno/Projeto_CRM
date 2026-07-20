import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://crm:crm@localhost:5432/isp_crm?schema=public",
    shadowDatabaseUrl:
      process.env.SHADOW_DATABASE_URL ??
      "postgresql://crm:crm@localhost:5432/isp_crm_shadow?schema=public",
  },
});
