import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { Modules } from "@medusajs/framework/utils";
import type { ICacheService, ILockingModule } from "@medusajs/framework/types";
import Redis from "ioredis";

jest.setTimeout(60 * 1000);

// integration-tests/setup.js points this at a Redis database of its own, one
// per jest worker. The flush below is safe because of that.
const redisUrl = process.env.REDIS_URL!;

async function withRedis<T>(use: (redis: Redis) => Promise<T>): Promise<T> {
  const redis = new Redis(redisUrl);
  try {
    return await use(redis);
  } finally {
    await redis.quit();
  }
}

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  hooks: {
    // Empty the database before the backend starts. Every key found after this
    // point comes from this run, and not from a run before it.
    beforeServerStart: async () => {
      await withRedis((redis) => redis.flushdb());
    },
  },
  testSuite: ({ api, getContainer }) => {
    describe("Health", () => {
      it("ping the server health endpoint", async () => {
        const response = await api.get("/health");

        expect(response.status).toEqual(200);
      });

      // The check /health cannot make. Unregistered, these modules fall back to
      // in-memory stand-ins silently; registered but pointed at a dead Redis,
      // Medusa logs the connection failure and serves anyway. Either way
      // /health returns 200, so it alone says nothing about ADR-0006.
      it("runs its event bus and workflow engine on Redis", async () => {
        // Both queue on boot, so their keys are already there to find.
        const keys = await withRedis((redis) => redis.keys("*"));

        expect(keys.filter((key) => key.startsWith("RedisEventBusService:"))).not.toHaveLength(0);
        expect(keys.filter((key) => key.startsWith("bull:medusa-workflows"))).not.toHaveLength(0);
      });

      it("caches in Redis", async () => {
        // Caching and locking write only when used, so unlike the two above
        // they have to be exercised before Redis can be asked about them.
        const cache = getContainer().resolve<ICacheService>(Modules.CACHE);
        await cache.set("mze-store:cache-probe", { probed: true }, 60);

        const cached = await withRedis((redis) => redis.keys("*mze-store:cache-probe*"));

        expect(cached).not.toHaveLength(0);
      });

      it("takes locks in Redis", async () => {
        const locking = getContainer().resolve<ILockingModule>(Modules.LOCKING);

        // Sampled from inside the job: the provider releases the key on the way
        // out, so after `execute` resolves there is nothing left to observe.
        const keysWhileHeld = await locking.execute("mze-store:lock-probe", () =>
          withRedis((redis) => redis.keys("*mze-store:lock-probe*")),
        );

        expect(keysWhileHeld).not.toHaveLength(0);
      });
    });
  },
});
