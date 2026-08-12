import { type ESTree } from "@oxlint/plugins";
import * as Effect from "effect/Effect";
import { FileContext, Rule, Visitor } from "effect-oxlint";

type BroadRecordType = "Record<string, unknown>" | "Record<string, any>" | "[key: string]: unknown";

function getRecordType(node: ESTree.TSTypeReference): BroadRecordType | null {
  if (node.typeName.type !== "Identifier" || node.typeName.name !== "Record") {
    return null;
  }

  const parameters = node.typeArguments?.params;

  if (parameters?.length !== 2 || parameters[0]?.type !== "TSStringKeyword") {
    return null;
  }

  if (parameters[1]?.type === "TSUnknownKeyword") {
    return "Record<string, unknown>";
  }

  return parameters[1]?.type === "TSAnyKeyword" ? "Record<string, any>" : null;
}

function isBroadIndexSignature(node: ESTree.TSIndexSignature): boolean {
  const [parameter] = node.parameters;

  return (
    parameter?.typeAnnotation.typeAnnotation.type === "TSStringKeyword" &&
    node.typeAnnotation.typeAnnotation.type === "TSUnknownKeyword"
  );
}

function reportBroadRecordType(
  context: FileContext.FileContextService,
  node: ESTree.TSTypeReference,
): void {
  const pattern = getRecordType(node);

  if (pattern) {
    context.report({
      node,
      messageId: "noBroadRecordType",
      data: { pattern },
    });
  }
}

function reportBroadIndexSignature(
  context: FileContext.FileContextService,
  node: ESTree.TSIndexSignature,
): void {
  if (isBroadIndexSignature(node)) {
    context.report({
      node,
      messageId: "noBroadRecordType",
      data: { pattern: "[key: string]: unknown" },
    });
  }
}

const noBroadRecordTypesPlan = Rule.plan({
  meta: {
    type: "problem",
    docs: {
      description: "Require named domain types instead of open string-keyed dictionaries.",
      recommended: true,
    },
    messages: {
      noBroadRecordType:
        "Replace {{pattern}} with a named domain type with explicit fields. Decode external input at the boundary (for example, with Effect Schema); no safe automatic fix exists.",
    },
  },
  create: () =>
    Effect.succeed({
      syncVisitors: Visitor.merge(
        Visitor.onSync("TSTypeReference", (node, context) => {
          reportBroadRecordType(context, node);
        }),
        Visitor.onSync("TSIndexSignature", (node, context) => {
          reportBroadIndexSignature(context, node);
        }),
      ),
    }),
});

export const noBroadRecordTypesRule = Rule.compile(noBroadRecordTypesPlan);
