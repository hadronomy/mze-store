import { getAuth } from "@mze-store/auth/instance";
import type { H3EventContext } from "evlog";
import { type BetterAuthInstance, createAuthMiddleware } from "evlog/better-auth";
import { defineMiddleware } from "nitro";

// Middleware, not a plugin. evlog's docs are explicit that `createAuthIdentifier`
// suits standalone Nitro "where the evlog Nitro module handles hook ordering",
// and that everywhere else — Nuxt, and equally TanStack Start — plugin hook
// ordering can leave the logger absent in the `request` hook. Middleware runs
// during handling, after every `request` hook, so the logger is always there.
type Identify = ReturnType<typeof createAuthMiddleware>;

let identifyRequest: Identify | undefined;

function identify(...args: Parameters<Identify>) {
  identifyRequest ??= createAuthMiddleware(getAuth() as BetterAuthInstance, {
    exclude: ["/api/auth/**"],
    maskEmail: true,
  });

  return identifyRequest(...args);
}

export default defineMiddleware(async (event, next) => {
  // The same logger the documented `useRequest().context.log` accessor returns;
  // we already hold the event, so reach for it directly. Absent means evlog is
  // disabled, in which case identification is skipped rather than fatal.
  const { log } = event.req.context as H3EventContext;

  if (log) {
    await identify(log, event.req.headers, event.url.pathname);
  }

  return next();
});
