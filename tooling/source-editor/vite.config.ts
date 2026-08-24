import { defineConfig } from "vite-plus";
import { packageBuildTask, packageTypecheckTask } from "../vite/package-tasks";

const entries = {
  extension: "src/extension/extension.ts",
  server: "src/server/server.ts",
};

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  pack: {
    entry: entries,
    deps: {
      alwaysBundle: [
        "@volar/language-core",
        "typescript",
        "vscode-languageclient",
        "vscode-languageserver",
        "vscode-languageserver-textdocument",
      ],
      neverBundle: ["vscode"],
    },
    format: {
      cjs: { entry: entries },
    },
    platform: "node",
  },
  run: {
    tasks: {
      build: packageBuildTask("vp pack"),
      "check-types": packageTypecheckTask(),
    },
  },
});
