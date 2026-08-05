import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { resolve } from "node:path";

jest.setTimeout(60 * 1000);

type AccountOrOperatorTable = {
  schema_name: string;
  table_oid: string;
};

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ dbConfig, dbConnection }) => {
    beforeAll(async () => {
      const authDb = drizzle(dbConfig.clientUrl);

      try {
        await migrate(authDb, {
          migrationsFolder: resolve(process.cwd(), "../../packages/db/src/migrations"),
        });
      } finally {
        await authDb.$client.end();
      }
    });

    describe("Account and Operator tables", () => {
      it("keeps the Account table separate from the Operator table", async () => {
        const { rows } = await dbConnection.raw(`
          SELECT namespace.nspname AS schema_name, table_class.oid::text AS table_oid
          FROM pg_class AS table_class
          JOIN pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
          WHERE table_class.relname = 'user'
            AND table_class.relkind = 'r'
            AND namespace.nspname IN ('auth', 'public')
          ORDER BY namespace.nspname
        `);
        const accountAndOperatorTables = rows as AccountOrOperatorTable[];

        expect(accountAndOperatorTables).toEqual([
          { schema_name: "auth", table_oid: expect.any(String) },
          { schema_name: "public", table_oid: expect.any(String) },
        ]);
        expect(new Set(accountAndOperatorTables.map(({ table_oid }) => table_oid)).size).toEqual(2);
      });
    });
  },
});
