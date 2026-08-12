import { definePlugin, eslintCompatPlugin } from "@oxlint/plugins";

import { noBroadRecordTypesRule, preferTildeImportsRule } from "./rules.ts";

const plugin = definePlugin({
  meta: { name: "hadronomy" },
  rules: {
    "prefer-tilde-imports": preferTildeImportsRule,
    "no-broad-record-types": noBroadRecordTypesRule,
  },
});

export default eslintCompatPlugin(plugin);
