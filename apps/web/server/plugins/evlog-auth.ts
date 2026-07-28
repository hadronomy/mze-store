import { auth } from "@mze-store/auth";
import { createAuthIdentifier, type BetterAuthInstance } from "evlog/better-auth";

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook(
    "request",
    createAuthIdentifier(auth as BetterAuthInstance, {
      exclude: ["/api/auth/**"],
      maskEmail: true,
    }),
  );
});
