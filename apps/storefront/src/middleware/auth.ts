import { getAuth } from "@mze-store/auth/instance";
import { createMiddleware } from "@tanstack/react-start";

export const authMiddleware = createMiddleware().server(async ({ next, request }) => {
  const session = await getAuth().api.getSession({
    headers: request.headers,
  });
  return next({
    context: { session },
  });
});
