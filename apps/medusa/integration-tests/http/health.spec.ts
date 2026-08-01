import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { Modules } from "@medusajs/framework/utils";
import type { ICacheService, ILockingModule } from "@medusajs/framework/types";
import Redis from "ioredis";

jest.setTimeout(60 * 1000);

// This suite flushes the database it points at, so it must never be the one a
// developer's `medusa develop` is using. ioredis defaults an absent URL to
// localhost index 0 — which is exactly that database — so refuse both rather
// than let a green run quietly cost someone their in-flight workflows.
function resolveTestRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      "REDIS_URL must be set to run the integration suite. See apps/medusa/.env.test.",
    );
  }

  const databaseIndex = new URL(url).pathname.replace("/", "");
  if (databaseIndex === "" || databaseIndex === "0") {
    throw new Error(
      `REDIS_URL must name a database index other than 0, which development uses. Got: ${url}`,
    );
  }

  return url;
}

const redisUrl = resolveTestRedisUrl();

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
    // Emptied before the app loads, so anything found in here afterwards was
    // necessarily put there by this run rather than left by an earlier one.
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
