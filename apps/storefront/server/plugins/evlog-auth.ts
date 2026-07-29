import { auth } from "@mze-store/auth";
import { type BetterAuthInstance, createAuthMiddleware } from "evlog/better-auth";
import { definePlugin } from "nitro";

// `createAuthIdentifier` is evlog's Nitro v2 helper: it reads `event.path`,
// `event.headers`, and `event.context`, none of which exist on an H3 v2 event.
// `createAuthMiddleware` is the framework-agnostic primitive underneath it, so
// we hand it the pieces ourselves and it works on any event shape.
const identify = createAuthMiddleware(auth as BetterAuthInstance, {
  exclude: ["/api/auth/**"],
  maskEmail: true,
});

type RequestLogger = Parameters<typeof identify>[0];

export default definePlugin(async (nitroApp) => {
  // evlog's plugin awaits its own config before registering its `request`
  // hook, so it always registers last regardless of plugin array order. Hooks
  // fire in registration order, so registering synchronously here would put us
  // first — before the logger exists on the context. Yielding a macrotask puts
  // our registration after evlog's, still long before the server accepts a
  // connection.
  await new Promise((resolve) => setTimeout(resolve, 0));

  nitroApp.hooks.hook("request", async (event) => {
    // evlog stores the request logger on `event.req.context`, typed as a bare
    // index signature — hence the cast. Absent means evlog is disabled.
    const log = event.req.context?.log as RequestLogger | undefined;
    if (!log) {
      return;
    }

    await identify(log, event.req.headers, new URL(event.req.url).pathname);
  });
});
