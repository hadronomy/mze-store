import {
  SourceMap,
  type CodeInformation,
  type Mapping,
  type VirtualCode,
} from "@volar/language-core";
import ts from "typescript";

import { sourceOffsetToVirtual, type SourceBlock, virtualOffsetToSource } from "../core/index.ts";

const literalFeatures: CodeInformation = Object.freeze({
  verification: true,
  completion: true,
  semantic: true,
  navigation: true,
  structure: true,
  format: true,
});

export interface SourceVirtualDocument {
  readonly block: SourceBlock;
  readonly hostFileName: string;
  readonly virtualFileName: string;
  readonly virtualCode: VirtualCode;
  readonly sourceMap: SourceMap<CodeInformation>;
}

/**
 * Creates the Volar virtual document for one literal source block.
 *
 * Substitutions are present in the generated text as placeholders, but they
 * have no mappings. This prevents language-service results from crossing the
 * host expression that supplies the substitution.
 */
export function createSourceVirtualDocument(
  hostFileName: string,
  block: SourceBlock,
  index: number,
): SourceVirtualDocument {
  const virtualFileName = `${hostFileName}.mze-source-${index}.${extensionFor(block)}`;
  const mappings = createLiteralMappings(block);
  const sourceMap = new SourceMap<CodeInformation>(mappings);
  const virtualCode: VirtualCode = {
    id: virtualFileName,
    languageId: languageIdFor(block),
    snapshot: ts.ScriptSnapshot.fromString(block.virtualText),
    mappings,
  };

  return { block, hostFileName, virtualFileName, virtualCode, sourceMap };
}

function createLiteralMappings(block: SourceBlock): Mapping<CodeInformation>[] {
  const mappings: Mapping<CodeInformation>[] = [];
  for (const mapping of block.literalRanges) {
    mappings.push({
      sourceOffsets: [mapping.source.start],
      generatedOffsets: [mapping.virtual.start],
      lengths: [mapping.source.end - mapping.source.start],
      generatedLengths: [mapping.virtual.end - mapping.virtual.start],
      data: literalFeatures,
    });
  }
  return mappings;
}

function extensionFor(block: SourceBlock): "js" | "ts" {
  return block.language === "js" ? "js" : "ts";
}

function languageIdFor(block: SourceBlock): "javascript" | "typescript" {
  return block.language === "js" ? "javascript" : "typescript";
}

export function mapHostOffset(block: SourceBlock, offset: number): number | undefined {
  if (isSubstitutionOffset(block, offset, "source")) return undefined;
  return sourceOffsetToVirtual(block, offset);
}

export function mapVirtualOffset(block: SourceBlock, offset: number): number | undefined {
  if (isSubstitutionOffset(block, offset, "virtual")) return undefined;
  return virtualOffsetToSource(block, offset);
}

export function rangeIntersectsSubstitution(
  block: SourceBlock,
  start: number,
  end: number,
  direction: "source" | "virtual",
): boolean {
  return block.substitutionRanges.some((mapping) => {
    const range = mapping[direction];
    return start < range.end && range.start < end;
  });
}

function isSubstitutionOffset(
  block: SourceBlock,
  offset: number,
  direction: "source" | "virtual",
): boolean {
  return block.substitutionRanges.some((mapping) => {
    const range = mapping[direction];
    return range.start <= offset && offset < range.end;
  });
}
