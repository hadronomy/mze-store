import { scan } from "react-scan";
import { useEffect } from "react";
import { Toaster } from "@mze-store/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { createMiddleware } from "@tanstack/react-start";
import { evlogErrorHandler } from "evlog/nitro/v3";

import Header from "~/components/header";

import appCss from "~/index.css?url";

export interface RouterAppContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  server: {
    middleware: [createMiddleware().server(evlogErrorHandler)],
  },

  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "MZE Store",
      },
      {
        name: "theme-color",
        content: "#FBFAF7",
      },
    ],
    // Order matters: where several icons are equally appropriate the browser
    // takes the last one, so the SVG follows the .ico and wins wherever it is
    // understood. `rel="shortcut icon"` is obsolete and deliberately absent.
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        href: "/favicon.ico",
        sizes: "32x32",
      },
      {
        rel: "icon",
        href: "/icon.svg",
        type: "image/svg+xml",
      },
      // iOS ignores `sizes` and rounds the corners itself, so one square
      // opaque file is the whole requirement.
      {
        rel: "apple-touch-icon",
        href: "/apple-touch-icon.png",
      },
      {
        rel: "manifest",
        href: "/manifest.webmanifest",
      },
    ],
  }),

  component: RootDocument,
});

function RootDocument() {
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    scan({ enabled: true });
    void import("react-grab");
  }, []);

  return (
    // The store is light-only (ADR-0024). Setting `dark` here fired every
    // `dark:` utility the primitives ship against a light palette.
    <html lang="es">
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="grid h-svh grid-rows-[auto_1fr]">
          <Header />
          <Outlet />
        </div>
        <Toaster richColors />
        <TanStackRouterDevtools position="bottom-left" />
        <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
        <Scripts />
      </body>
    </html>
  );
}
