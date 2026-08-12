import { definePlugin, eslintCompatPlugin } from "@oxlint/plugins";

import { preferTildeImportsRule } from "~/rules";

const plugin = definePlugin({
  meta: { name: "hadronomy" },
  rules: {
    "prefer-tilde-imports": preferTildeImportsRule,
  },
});

export default eslintCompatPlugin(plugin);
