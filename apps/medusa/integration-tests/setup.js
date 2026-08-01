const { MetadataStorage } = require("@medusajs/framework/mikro-orm/core");

MetadataStorage.clear();

// Give each jest worker its own Redis database. medusaIntegrationTestRunner
// gives each worker its own Postgres database in the same way.
//
// The suite flushes this database before the backend starts. Database 0 holds
// the state of `medusa develop`, so the suite must never flush it.
// JEST_WORKER_ID starts at 1. Database 0 is therefore unreachable from here,
// and no check for it is necessary.
//
// CAUTION: This code replaces the database index in REDIS_URL. The host and the
// port stay. An index in `.env.test`, or in the shell, has no effect.
if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL is not set. See apps/medusa/.env.test.");
}

const redisUrl = new URL(process.env.REDIS_URL);
redisUrl.pathname = `/${process.env.JEST_WORKER_ID || "1"}`;
process.env.REDIS_URL = redisUrl.toString();
