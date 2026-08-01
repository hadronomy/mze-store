import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import Redis from "ioredis";

jest.setTimeout(60 * 1000);

const redisUrl = process.env.REDIS_URL!;

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  hooks: {
    // Emptied before the app loads so that anything found in this database
    // afterwards was necessarily put there by this run. Without it the Redis
    // assertion below would pass on leftovers from an earlier one. `.env.test`
    // points at a dedicated database index, so this never touches dev state.
    beforeServerStart: async () => {
      const redis = new Redis(redisUrl);
      await redis.flushdb();
      await redis.quit();
    },
  },
  testSuite: ({ api }) => {
    describe("Health", () => {
      it("ping the server health endpoint", async () => {
        const response = await api.get("/health");

        expect(response.status).toEqual(200);
      });

      it("runs on a real Redis rather than Medusa's in-memory stand-ins", async () => {
        const redis = new Redis(redisUrl);
        const keys = await redis.keys("*");
        await redis.quit();

        // The check /health cannot make. Unregistered, these modules fall back
        // to in-memory stand-ins silently; registered but pointed at a dead
        // Redis, Medusa logs the connection failure and serves anyway. Either
        // way /health returns 200, so it alone says nothing about ADR-0006.
        //
        // The event bus and the workflow engine are the two of the four that
        // write to Redis on boot; medusa-config.ts points all four at this same
        // URL, so finding their queues here means the whole set is live.
        const eventBusKeys = keys.filter((key) => key.startsWith("RedisEventBusService:"));
        const workflowEngineKeys = keys.filter((key) => key.startsWith("bull:medusa-workflows"));

        expect(eventBusKeys.length).toBeGreaterThan(0);
        expect(workflowEngineKeys.length).toBeGreaterThan(0);
      });
    });
  },
});
