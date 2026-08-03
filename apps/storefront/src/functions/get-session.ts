import { createServerFn } from "@tanstack/react-start";

import { authMiddleware } from "~/middleware/auth";

export const getSession = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return context.session;
  });
