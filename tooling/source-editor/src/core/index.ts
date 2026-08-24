import ts from "typescript";

const sourceLanguages = ["js", "ts", "jsonc", "bash", "sql"] as const;

export type SourceLanguage = (typeof sourceLanguages)[number];

export interface OffsetRange {
  readonly start: number;
  readonly end: number;
}

interface SourceRangeMapping {
  readonly source: OffsetRange;
  readonly virtual: OffsetRange;
}

export interface SourceBlock {
  readonly language: SourceLanguage;
  readonly fullRange: OffsetRange;
  readonly bodyRange: OffsetRange;
  readonly literalRanges: readonly SourceRangeMapping[];
  readonly substitutionRanges: readonly SourceRangeMapping[];
  readonly virtualText: string;
}

const sourcePackage = "@mze-store/test";
const placeholderPrefix = "__mze_source_substitution_";

interface LiteralSegment {
  readonly range: OffsetRange;
}

interface SubstitutionSegment {
  readonly range: OffsetRange;
}

interface TemplateSegments {
  readonly bodyRange: OffsetRange;
  readonly literals: readonly LiteralSegment[];
  readonly substitutions: readonly SubstitutionSegment[];
}

interface DecodedLiteral {
  readonly text: string;
  readonly mappings: readonly SourceRangeMapping[];
}

interface DecodedEscape {
  readonly consumed: number;
  readonly value: string;
}

const simpleEscapes = new Map<string, string>([
  ["0", "\0"],
  ["b", "\b"],
  ["f", "\f"],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
  ["v", "\v"],
  ["\\", "\\"],
  ["`", "`"],
  ["'", "'"],
  ['"', '"'],
]);

/**
 * Finds `src.<language>` tagged templates imported from `@mze-store/test`.
 * The returned virtual text is cooked, dedented like the runtime helper, and
 * replaces each interpolation with a stable identifier. Source ranges use
 * UTF-16 offsets, like the TypeScript and VS Code APIs.
 */
export function scanSourceBlocks(text: string, fileName: string): SourceBlock[] {
  const scriptKind = scriptKindFor(fileName);
  if (scriptKind === undefined) return [];

  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind);
  if (!importsSourceTag(sourceFile)) return [];

  const blocks: SourceBlock[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node)) {
      const language = languageForTag(node.tag);
      if (language !== undefined) {
        const segments = templateSegments(node.template, text);
        blocks.push(buildBlock(language, node, segments, text));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return blocks.sort((left, right) => left.fullRange.start - right.fullRange.start);
}

/** Maps a host-source offset into a virtual document offset. */
export function sourceOffsetToVirtual(block: SourceBlock, offset: number): number | undefined {
  return mapOffset(offset, allMappings(block), "source");
}

/** Maps a virtual document offset back into the host-source offset. */
export function virtualOffsetToSource(block: SourceBlock, offset: number): number | undefined {
  return mapOffset(offset, allMappings(block), "virtual");
}

/** Maps a host-source range into a virtual document range. */
export function mapSourceRange(block: SourceBlock, range: OffsetRange): OffsetRange | undefined {
  const start = sourceOffsetToVirtual(block, range.start);
  const end = sourceOffsetToVirtual(block, range.end);
  if (start === undefined || end === undefined) return undefined;
  return { start, end };
}

/** Maps a virtual document range back into the host-source range. */
export function mapVirtualRange(block: SourceBlock, range: OffsetRange): OffsetRange | undefined {
  const start = virtualOffsetToSource(block, range.start);
  const end = virtualOffsetToSource(block, range.end);
  if (start === undefined || end === undefined) return undefined;
  return { start, end };
}

function scriptKindFor(fileName: string): ts.ScriptKind | undefined {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lowerName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lowerName.endsWith(".ts")) return ts.ScriptKind.TS;
  if (lowerName.endsWith(".js")) return ts.ScriptKind.JS;
  return undefined;
}

function importsSourceTag(sourceFile: ts.SourceFile): boolean {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== sourcePackage) continue;

    const clause = statement.importClause;
    if (clause === undefined || clause.isTypeOnly) continue;
    const bindings = clause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;

    for (const specifier of bindings.elements) {
      if (specifier.isTypeOnly) continue;
      if (specifier.propertyName === undefined && specifier.name.text === "src") return true;
    }
  }
  return false;
}

function languageForTag(tag: ts.LeftHandSideExpression): SourceLanguage | undefined {
  if (!ts.isPropertyAccessExpression(tag)) return undefined;
  if (!ts.isIdentifier(tag.expression)) return undefined;
  if (tag.expression.text !== "src") return undefined;
  return isSourceLanguage(tag.name.text) ? tag.name.text : undefined;
}

function isSourceLanguage(value: string): value is SourceLanguage {
  return (sourceLanguages as readonly string[]).includes(value);
}

function templateSegments(template: ts.TemplateLiteral, text: string): TemplateSegments {
  const templateStart = template.getStart();
  const templateEnd = template.end;
  const bodyStart = Math.min(templateStart + 1, templateEnd);
  const hasClosingBacktick = text[templateEnd - 1] === "`";
  const bodyEnd = hasClosingBacktick ? Math.max(bodyStart, templateEnd - 1) : templateEnd;
  const literals: LiteralSegment[] = [];
  const substitutions: SubstitutionSegment[] = [];

  if (ts.isNoSubstitutionTemplateLiteral(template)) {
    addLiteral(literals, bodyStart, bodyEnd);
    return { bodyRange: { start: bodyStart, end: bodyEnd }, literals, substitutions };
  }

  addLiteral(
    literals,
    bodyStart,
    removeTemplateDelimiter(template.head.end, text, bodyStart, "open"),
  );

  let previousLiteralEnd = bodyStart;
  for (const span of template.templateSpans) {
    const expressionStart = span.expression.getStart();
    const openingStart = Math.max(bodyStart, span.pos - 2);
    const literalStart = clamp(span.literal.getStart(), bodyStart, templateEnd);
    const hasClosingBrace = text[literalStart] === "}";
    const substitutionEnd = hasClosingBrace
      ? Math.min(templateEnd, literalStart + 1)
      : Math.max(expressionStart, Math.min(templateEnd, span.end));

    substitutions.push({
      range: {
        start: Math.max(previousLiteralEnd, openingStart),
        end: Math.max(Math.max(previousLiteralEnd, openingStart), substitutionEnd),
      },
    });

    const segmentStart = hasClosingBrace ? literalStart + 1 : literalStart;
    const literalEnd = removeTemplateDelimiter(
      span.literal.end,
      text,
      segmentStart,
      text.slice(Math.max(segmentStart, span.literal.end - 2), span.literal.end) === "${"
        ? "open"
        : "close",
    );
    addLiteral(literals, segmentStart, literalEnd);
    previousLiteralEnd = literalEnd;
  }

  return { bodyRange: { start: bodyStart, end: bodyEnd }, literals, substitutions };
}

function removeTemplateDelimiter(
  end: number,
  text: string,
  minimum: number,
  kind: "open" | "close",
): number {
  if (kind === "open" && text.slice(end - 2, end) === "${") {
    return Math.max(minimum, end - 2);
  }
  if (kind === "close" && text[end - 1] === "`") {
    return Math.max(minimum, end - 1);
  }
  return Math.max(minimum, end);
}

function addLiteral(literals: LiteralSegment[], start: number, end: number): void {
  literals.push({ range: { start, end } });
}

function buildBlock(
  language: SourceLanguage,
  taggedTemplate: ts.TaggedTemplateExpression,
  segments: TemplateSegments,
  sourceText: string,
): SourceBlock {
  let virtualText = "";
  const literalRanges: SourceRangeMapping[] = [];
  const substitutionRanges: SourceRangeMapping[] = [];

  const literalsByStart = [...segments.literals].sort(
    (left, right) => left.range.start - right.range.start,
  );
  const decodedLiterals = dedentLiterals(
    literalsByStart.map((literal) =>
      decodeLiteral(sourceText.slice(literal.range.start, literal.range.end), literal.range.start),
    ),
  );
  const substitutionsByStart = [...segments.substitutions].sort(
    (left, right) => left.range.start - right.range.start,
  );
  let literalIndex = 0;
  let substitutionIndex = 0;

  while (literalIndex < literalsByStart.length || substitutionIndex < substitutionsByStart.length) {
    const literal = literalsByStart[literalIndex];
    const substitution = substitutionsByStart[substitutionIndex];

    if (
      substitution !== undefined &&
      (literal === undefined || substitution.range.start < literal.range.start)
    ) {
      const sourceRange = substitution.range;
      const sourceSlice = sourceText.slice(sourceRange.start, sourceRange.end);
      const placeholder = placeholderFor(substitutionIndex, sourceSlice);
      const virtualRange: OffsetRange = {
        start: virtualText.length,
        end: virtualText.length + placeholder.length,
      };
      virtualText += placeholder;
      substitutionRanges.push({ source: sourceRange, virtual: virtualRange });
      substitutionIndex += 1;
      continue;
    }

    if (literal === undefined) continue;
    const decoded = decodedLiterals[literalIndex]!;
    literalRanges.push(...shiftVirtualRanges(decoded.mappings, virtualText.length));
    virtualText += decoded.text;
    literalIndex += 1;
  }

  return {
    language,
    fullRange: { start: taggedTemplate.getStart(), end: taggedTemplate.end },
    bodyRange: segments.bodyRange,
    literalRanges,
    substitutionRanges,
    virtualText,
  };
}

/** Keep this transform in sync with the `ts-dedent` call in `@mze-store/test`. */
function dedentLiterals(literals: readonly DecodedLiteral[]): DecodedLiteral[] {
  if (literals.length === 0) return [];

  const deletions = literals.map((): OffsetRange[] => []);
  const values = literals.map((literal) => literal.text);
  const lastIndex = values.length - 1;
  const trailingLine = /\n[\t ]*$/.exec(values[lastIndex]!);
  if (trailingLine?.index !== undefined) {
    deletions[lastIndex]!.push({ start: trailingLine.index, end: values[lastIndex]!.length });
    values[lastIndex] = values[lastIndex]!.slice(0, trailingLine.index);
  }

  const indentations = values.flatMap((value) =>
    [...value.matchAll(/\n([\t ]+|(?!\s).)/g)].map(
      (match) => match[0].match(/[\t ]/g)?.length ?? 0,
    ),
  );

  if (indentations.length > 0) {
    const indentation = Math.min(...indentations);
    const pattern = new RegExp(`\\n[\\t ]{${indentation}}`, "g");
    for (const [index, value] of values.entries()) {
      for (const match of value.matchAll(pattern)) {
        const start = (match.index ?? 0) + 1;
        if (indentation > 0) deletions[index]!.push({ start, end: start + indentation });
      }
    }
  }

  if (values[0]!.startsWith("\n")) deletions[0]!.push({ start: 0, end: 1 });

  return literals.map((literal, index) => applyDeletions(literal, deletions[index]!));
}

function applyDeletions(literal: DecodedLiteral, ranges: readonly OffsetRange[]): DecodedLiteral {
  const deletions = normalizeRanges(ranges);
  return {
    mappings: compactMappings(remapAfterDeletions(literal.mappings, deletions)),
    text: deletions.length === 0 ? literal.text : removeRanges(literal.text, deletions),
  };
}

function normalizeRanges(ranges: readonly OffsetRange[]): OffsetRange[] {
  const normalized: OffsetRange[] = [];

  for (const range of ranges.toSorted((left, right) => left.start - right.start)) {
    const previous = normalized.at(-1);
    if (previous === undefined || range.start > previous.end) {
      normalized.push(range);
      continue;
    }
    normalized[normalized.length - 1] = {
      start: previous.start,
      end: Math.max(previous.end, range.end),
    };
  }

  return normalized;
}

function removeRanges(text: string, ranges: readonly OffsetRange[]): string {
  let result = "";
  let cursor = 0;

  for (const range of ranges) {
    result += text.slice(cursor, range.start);
    cursor = range.end;
  }

  return result + text.slice(cursor);
}

function remapAfterDeletions(
  mappings: readonly SourceRangeMapping[],
  deletions: readonly OffsetRange[],
): SourceRangeMapping[] {
  return mappings.map((mapping): SourceRangeMapping => {
    const removed = deletions.some(
      (deletion) => mapping.virtual.start >= deletion.start && mapping.virtual.end <= deletion.end,
    );
    const start = collapseOffset(mapping.virtual.start, deletions);
    return {
      source: mapping.source,
      virtual: {
        start,
        end: removed ? start : collapseOffset(mapping.virtual.end, deletions),
      },
    };
  });
}

function compactMappings(mappings: readonly SourceRangeMapping[]): SourceRangeMapping[] {
  const compacted: SourceRangeMapping[] = [];

  for (const mapping of mappings) {
    const previous = compacted.at(-1);
    const joinsEmptyRanges =
      previous?.source.end === mapping.source.start &&
      previous.virtual.start === previous.virtual.end &&
      mapping.virtual.start === mapping.virtual.end &&
      previous.virtual.end === mapping.virtual.start;
    const joinsDirectRanges =
      previous?.source.end === mapping.source.start &&
      previous.virtual.end === mapping.virtual.start &&
      previous.source.end - previous.source.start ===
        previous.virtual.end - previous.virtual.start &&
      mapping.source.end - mapping.source.start === mapping.virtual.end - mapping.virtual.start;

    if (previous !== undefined && (joinsEmptyRanges || joinsDirectRanges)) {
      compacted[compacted.length - 1] = {
        source: { start: previous.source.start, end: mapping.source.end },
        virtual: { start: previous.virtual.start, end: mapping.virtual.end },
      };
    } else {
      compacted.push(mapping);
    }
  }

  return compacted;
}

function collapseOffset(offset: number, deletions: readonly OffsetRange[]): number {
  return deletions.reduce(
    (collapsed, deletion) =>
      collapsed - Math.max(0, Math.min(offset, deletion.end) - deletion.start),
    offset,
  );
}

function shiftVirtualRanges(
  mappings: readonly SourceRangeMapping[],
  offset: number,
): SourceRangeMapping[] {
  return mappings.map((mapping) => ({
    source: mapping.source,
    virtual: {
      start: mapping.virtual.start + offset,
      end: mapping.virtual.end + offset,
    },
  }));
}

function placeholderFor(index: number, sourceSlice: string): string {
  const base = `${placeholderPrefix}${index}__`;
  const lineBreaks = sourceSlice.match(/\r\n|\r|\n/g);
  if (!lineBreaks) return base;
  return `${base}${lineBreaks.map(() => "\n").join("")}`;
}

function decodeLiteral(raw: string, sourceStart: number): DecodedLiteral {
  let text = "";
  const mappings: SourceRangeMapping[] = [];
  let index = 0;

  const append = (rawStart: number, rawEnd: number, value: string): void => {
    const virtualRange = {
      start: text.length,
      end: text.length + value.length,
    };
    const sourceRange = { start: sourceStart + rawStart, end: sourceStart + rawEnd };
    if (sourceRange.start === sourceRange.end) return;
    mappings.push({ source: sourceRange, virtual: virtualRange });
    text += value;
  };

  while (index < raw.length) {
    const character = raw[index];
    if (character !== "\\") {
      if (character === "\r") {
        append(index, index + (raw[index + 1] === "\n" ? 2 : 1), "\n");
        index += raw[index + 1] === "\n" ? 2 : 1;
      } else if (character === "\n") {
        append(index, index + 1, "\n");
        index += 1;
      } else {
        append(index, index + 1, character!);
        index += 1;
      }
      continue;
    }

    const escape = decodeEscape(raw, index);
    append(index, index + escape.consumed, escape.value);
    index += escape.consumed;
  }

  return { text, mappings };
}

function decodeEscape(raw: string, start: number): DecodedEscape {
  if (start + 1 >= raw.length) return { consumed: 1, value: "\\" };
  const escaped = raw[start + 1]!;
  const simple = simpleEscapes.get(escaped);
  if (simple !== undefined) return { consumed: 2, value: simple };
  if (escaped === "\r" || escaped === "\n") {
    return {
      consumed: escaped === "\r" && raw[start + 2] === "\n" ? 3 : 2,
      value: "",
    };
  }
  if (escaped === "x") {
    const digits = raw.slice(start + 2, start + 4);
    if (/^[0-9a-fA-F]{2}$/.test(digits)) {
      return { consumed: 4, value: String.fromCharCode(Number.parseInt(digits, 16)) };
    }
    return { consumed: 1, value: "\\" };
  }
  if (escaped === "u") {
    if (raw[start + 2] === "{") {
      const close = raw.indexOf("}", start + 3);
      const digits = close === -1 ? "" : raw.slice(start + 3, close);
      if (close !== -1 && /^[0-9a-fA-F]+$/.test(digits)) {
        const codePoint = Number.parseInt(digits, 16);
        if (codePoint <= 0x10ffff) {
          return {
            consumed: close + 1 - start,
            value: String.fromCodePoint(codePoint),
          };
        }
      }
    } else {
      const digits = raw.slice(start + 2, start + 6);
      if (/^[0-9a-fA-F]{4}$/.test(digits)) {
        return { consumed: 6, value: String.fromCharCode(Number.parseInt(digits, 16)) };
      }
    }
    return { consumed: 1, value: "\\" };
  }
  return { consumed: 2, value: escaped };
}

function allMappings(block: SourceBlock): readonly SourceRangeMapping[] {
  return [...block.literalRanges, ...block.substitutionRanges].sort(
    (left, right) => left.source.start - right.source.start,
  );
}

function mapOffset(
  offset: number,
  mappings: readonly SourceRangeMapping[],
  direction: "source" | "virtual",
): number | undefined {
  for (const mapping of mappings) {
    const from = mapping[direction];
    if (from.start === offset && from.end > from.start) {
      return mapping[direction === "source" ? "virtual" : "source"].start;
    }
  }

  for (const mapping of mappings) {
    const from = mapping[direction];
    const to = mapping[direction === "source" ? "virtual" : "source"];
    if (offset < from.start || offset > from.end) continue;

    const fromLength = from.end - from.start;
    const toLength = to.end - to.start;
    if (fromLength === 0) return to.start;
    if (offset === from.end) return to.end;
    if (fromLength === toLength) return to.start + offset - from.start;

    const fraction = (offset - from.start) / fromLength;
    return to.start + Math.min(toLength, Math.floor(fraction * toLength));
  }
  return undefined;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
