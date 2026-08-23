import ts from "typescript";

import {
  mapSourceRange,
  mapVirtualRange,
  scanSourceBlocks,
  type SourceLanguage,
} from "../core/index.ts";
import {
  createSourceVirtualDocument,
  mapHostOffset,
  mapVirtualOffset,
  rangeIntersectsSubstitution,
  type SourceVirtualDocument,
} from "./virtual-document.ts";

export interface SourceDocument {
  readonly fileName: string;
  readonly text: string;
  readonly version?: string | number;
}

export interface SourcePosition {
  readonly fileName: string;
  readonly offset: number;
}

interface SourceRange {
  readonly end: number;
  readonly fileName: string;
  readonly start: number;
}

export interface SourceSpan {
  readonly fileName: string;
  readonly start: number;
  readonly length: number;
}

interface MappedDiagnostic extends SourceSpan {
  readonly diagnostic: ts.Diagnostic;
  readonly message: string;
}

interface SourceCompletion {
  readonly info: ts.WithMetadata<ts.CompletionInfo>;
  readonly items: readonly SourceCompletionItem[];
}

interface SourceCompletionItem {
  readonly entry: ts.CompletionEntry;
  readonly replacementSpan?: SourceSpan;
}

interface SourceHover {
  readonly info: ts.QuickInfo;
  readonly range: SourceSpan;
}

interface SourceLocation<T> extends SourceSpan {
  readonly data: T;
}

interface SourceRename {
  readonly info: ts.RenameInfo;
  readonly newName: string;
  readonly locations: readonly SourceLocation<ts.RenameLocation>[];
}

interface SourceTextChange extends SourceSpan {
  readonly newText: string;
  readonly data: ts.TextChange;
}

interface SourceCodeAction {
  readonly action: ts.CodeFixAction;
  readonly changes: readonly SourceTextChange[];
}

interface SourceRefactorEdits {
  readonly result: ts.RefactorEditInfo;
  readonly changes: readonly SourceTextChange[];
  readonly renameLocation?: SourcePosition;
}

interface SourceSemanticClassifications {
  readonly spans: readonly number[];
  readonly endOfLineState: ts.EndOfLineState;
}

interface SourceInlayHint {
  readonly hint: ts.InlayHint;
  readonly position: SourcePosition;
  readonly displayParts?: readonly ts.InlayHintDisplayPart[];
}

export interface SourceLanguageServiceOptions {
  readonly documents: readonly SourceDocument[];
  readonly projectFiles?: readonly SourceDocument[];
  readonly compilerOptions?: ts.CompilerOptions;
  readonly currentDirectory?: string;
}

export interface SourceLanguageService {
  updateDocument(document: SourceDocument): void;
  removeDocument(fileName: string): void;
  getDiagnostics(fileName: string): readonly MappedDiagnostic[];
  getCompletions(
    position: SourcePosition,
    options?: ts.GetCompletionsAtPositionOptions,
    formattingSettings?: ts.FormatCodeSettings,
  ): SourceCompletion | undefined;
  getHover(position: SourcePosition, maximumLength?: number): SourceHover | undefined;
  getDefinitions(
    position: SourcePosition,
  ): readonly SourceLocation<ts.DefinitionInfo>[] | undefined;
  getReferences(position: SourcePosition): readonly SourceLocation<ts.ReferenceEntry>[] | undefined;
  getRename(position: SourcePosition, newName: string): SourceRename;
  getFormatting(
    fileName: string,
    range?: SourceRange,
    options?: ts.FormatCodeSettings,
  ): readonly SourceTextChange[];
  getCodeActions(
    range: SourceRange,
    errorCodes?: readonly number[],
    options?: ts.FormatCodeSettings,
    preferences?: ts.UserPreferences,
  ): readonly SourceCodeAction[];
  getApplicableRefactors(
    range: SourceRange,
    preferences?: ts.UserPreferences,
  ): readonly ts.ApplicableRefactorInfo[];
  getRefactorEdits(
    range: SourceRange,
    refactorName: string,
    actionName: string,
    options?: ts.FormatCodeSettings,
    preferences?: ts.UserPreferences,
  ): SourceRefactorEdits | undefined;
  getSemanticClassifications(range: SourceRange): SourceSemanticClassifications | undefined;
  getInlayHints(range: SourceRange, preferences?: ts.UserPreferences): readonly SourceInlayHint[];
  dispose(): void;
}

interface VirtualBlock {
  readonly document: SourceVirtualDocument;
  readonly hostDocument: SourceDocument;
}

interface LanguageServiceHost extends ts.LanguageServiceHost {
  readonly projectVersion: number;
}

const defaultCompilerOptions: ts.CompilerOptions = {
  allowJs: true,
  checkJs: true,
  jsx: ts.JsxEmit.Preserve,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ESNext,
};

/**
 * Adapts the TypeScript language service to source blocks in host documents.
 *
 * Each block has an isolated virtual file. Only literal ranges receive Volar
 * mappings, so diagnostics and edits that touch a substitution are discarded.
 */
export function createSourceLanguageService(
  options: SourceLanguageServiceOptions,
): SourceLanguageService {
  return new SourceLanguageServiceImpl(options);
}

class SourceLanguageServiceImpl implements SourceLanguageService {
  private readonly documents = new Map<string, SourceDocument>();
  private readonly projectFiles = new Map<string, SourceDocument>();
  private readonly virtualBlocks = new Map<string, VirtualBlock>();
  private readonly blocksByHost = new Map<string, VirtualBlock[]>();
  private readonly options: ts.CompilerOptions;
  private readonly currentDirectory: string;
  private projectVersion = 0;
  private readonly host: LanguageServiceHost;
  private readonly languageService: ts.LanguageService;

  constructor(options: SourceLanguageServiceOptions) {
    this.options = { ...defaultCompilerOptions, ...options.compilerOptions };
    this.currentDirectory = options.currentDirectory ?? process.cwd();
    for (const document of options.documents) this.documents.set(document.fileName, document);
    for (const file of options.projectFiles ?? []) this.projectFiles.set(file.fileName, file);

    this.host = this.createHost();
    this.rebuildVirtualDocuments();
    this.languageService = ts.createLanguageService(this.host);
  }

  updateDocument(document: SourceDocument): void {
    this.documents.set(document.fileName, document);
    this.rebuildVirtualDocuments();
  }

  removeDocument(fileName: string): void {
    this.documents.delete(fileName);
    this.rebuildVirtualDocuments();
  }

  getDiagnostics(fileName: string): readonly MappedDiagnostic[] {
    const diagnostics: MappedDiagnostic[] = [];
    for (const virtualBlock of this.blocksByHost.get(fileName) ?? []) {
      const virtualFileName = virtualBlock.document.virtualFileName;
      const sourceDiagnostics = [
        ...this.languageService.getSyntacticDiagnostics(virtualFileName),
        ...this.languageService.getSemanticDiagnostics(virtualFileName),
        ...this.languageService.getSuggestionDiagnostics(virtualFileName),
      ];
      for (const diagnostic of sourceDiagnostics) {
        const span =
          diagnostic.start === undefined || diagnostic.length === undefined
            ? undefined
            : this.mapVirtualSpan(virtualFileName, {
                start: diagnostic.start,
                length: diagnostic.length,
              });
        if (span === undefined) continue;
        diagnostics.push({
          ...span,
          diagnostic,
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        });
      }
    }
    return diagnostics.sort((left, right) => left.start - right.start);
  }

  getCompletions(
    position: SourcePosition,
    options: ts.GetCompletionsAtPositionOptions = {
      triggerKind: ts.CompletionTriggerKind.Invoked,
    },
    formattingSettings?: ts.FormatCodeSettings,
  ): SourceCompletion | undefined {
    const location = this.findVirtualLocation(position);
    if (location === undefined) return undefined;
    const info = this.languageService.getCompletionsAtPosition(
      location.block.document.virtualFileName,
      location.offset,
      options,
      formattingSettings,
    );
    if (info === undefined) return undefined;
    return {
      info,
      items: info.entries.flatMap((entry) => {
        const virtualSpan = entry.replacementSpan ?? info.optionalReplacementSpan;
        if (virtualSpan === undefined) return [{ entry }];
        const replacementSpan = this.mapVirtualSpan(
          location.block.document.virtualFileName,
          virtualSpan,
        );
        return replacementSpan === undefined ? [] : [{ entry, replacementSpan }];
      }),
    };
  }

  getHover(position: SourcePosition, maximumLength?: number): SourceHover | undefined {
    const location = this.findVirtualLocation(position);
    if (location === undefined) return undefined;
    const info = this.languageService.getQuickInfoAtPosition(
      location.block.document.virtualFileName,
      location.offset,
      maximumLength,
    );
    if (info === undefined || info.textSpan === undefined) return undefined;
    const range = this.mapVirtualSpan(location.block.document.virtualFileName, info.textSpan);
    if (range === undefined) return undefined;
    return { info, range };
  }

  getDefinitions(
    position: SourcePosition,
  ): readonly SourceLocation<ts.DefinitionInfo>[] | undefined {
    const location = this.findVirtualLocation(position);
    if (location === undefined) return undefined;
    const definitions = this.languageService.getDefinitionAtPosition(
      location.block.document.virtualFileName,
      location.offset,
    );
    if (definitions === undefined) return undefined;
    return definitions.flatMap((definition) => {
      const span = this.mapVirtualSpan(definition.fileName, definition.textSpan);
      return span === undefined ? [] : [{ ...span, data: definition }];
    });
  }

  getReferences(
    position: SourcePosition,
  ): readonly SourceLocation<ts.ReferenceEntry>[] | undefined {
    const location = this.findVirtualLocation(position);
    if (location === undefined) return undefined;
    const references = this.languageService.getReferencesAtPosition(
      location.block.document.virtualFileName,
      location.offset,
    );
    if (references === undefined) return undefined;
    return references.flatMap((reference) => {
      const span = this.mapVirtualSpan(reference.fileName, reference.textSpan);
      return span === undefined ? [] : [{ ...span, data: reference }];
    });
  }

  getRename(position: SourcePosition, newName: string): SourceRename {
    const location = this.findVirtualLocation(position);
    if (location === undefined) {
      return {
        info: { canRename: false, localizedErrorMessage: "No source block at position" },
        newName,
        locations: [],
      };
    }
    const virtualFileName = location.block.document.virtualFileName;
    const info = this.languageService.getRenameInfo(virtualFileName, location.offset, {});
    if (!info.canRename) return { info, newName, locations: [] };
    const locations =
      this.languageService.findRenameLocations(
        virtualFileName,
        location.offset,
        false,
        false,
        {},
      ) ?? [];
    return {
      info,
      newName,
      locations: locations.flatMap((renameLocation) => {
        const span = this.mapVirtualSpan(renameLocation.fileName, renameLocation.textSpan);
        return span === undefined ? [] : [{ ...span, data: renameLocation }];
      }),
    };
  }

  getFormatting(
    fileName: string,
    range?: SourceRange,
    options: ts.FormatCodeSettings = ts.getDefaultFormatCodeSettings(),
  ): readonly SourceTextChange[] {
    if (range !== undefined) {
      const location = this.mapHostRange(range);
      if (location === undefined) return [];
      return this.mapTextChanges(
        location.fileName,
        this.languageService.getFormattingEditsForRange(
          location.fileName,
          location.start,
          location.end,
          options,
        ),
      );
    }

    return (this.blocksByHost.get(fileName) ?? []).flatMap((virtualBlock) =>
      this.mapTextChanges(
        virtualBlock.document.virtualFileName,
        this.languageService.getFormattingEditsForDocument(
          virtualBlock.document.virtualFileName,
          options,
        ),
      ),
    );
  }

  getCodeActions(
    range: SourceRange,
    errorCodes: readonly number[] = [],
    options: ts.FormatCodeSettings = ts.getDefaultFormatCodeSettings(),
    preferences: ts.UserPreferences = {},
  ): readonly SourceCodeAction[] {
    const location = this.mapHostRange(range);
    if (location === undefined) return [];
    const actions = this.languageService.getCodeFixesAtPosition(
      location.fileName,
      location.start,
      location.end,
      errorCodes,
      options,
      preferences,
    );
    return actions.flatMap((action) => {
      const changes = this.mapFileTextChanges(action.changes);
      return changes === undefined ? [] : [{ action, changes }];
    });
  }

  getApplicableRefactors(
    range: SourceRange,
    preferences: ts.UserPreferences = {},
  ): readonly ts.ApplicableRefactorInfo[] {
    const location = this.mapHostRange(range);
    if (location === undefined) return [];
    return this.languageService.getApplicableRefactors(
      location.fileName,
      { pos: location.start, end: location.end },
      preferences,
    );
  }

  getRefactorEdits(
    range: SourceRange,
    refactorName: string,
    actionName: string,
    options: ts.FormatCodeSettings = ts.getDefaultFormatCodeSettings(),
    preferences: ts.UserPreferences = {},
  ): SourceRefactorEdits | undefined {
    const location = this.mapHostRange(range);
    if (location === undefined) return undefined;
    const result = this.languageService.getEditsForRefactor(
      location.fileName,
      options,
      { pos: location.start, end: location.end },
      refactorName,
      actionName,
      preferences,
    );
    if (result === undefined) return undefined;
    const changes = this.mapFileTextChanges(result.edits);
    if (changes === undefined) return undefined;
    const renameBlock =
      result.renameFilename === undefined
        ? undefined
        : this.virtualBlocks.get(result.renameFilename);
    const renameLocation =
      result.renameLocation === undefined || renameBlock === undefined
        ? undefined
        : mapVirtualOffset(renameBlock.document.block, result.renameLocation);
    if (
      result.renameLocation !== undefined &&
      renameBlock !== undefined &&
      renameLocation === undefined
    ) {
      return undefined;
    }
    return {
      result,
      changes,
      renameLocation:
        renameLocation === undefined || renameBlock === undefined
          ? undefined
          : { fileName: renameBlock.hostDocument.fileName, offset: renameLocation },
    };
  }

  getSemanticClassifications(range: SourceRange): SourceSemanticClassifications | undefined {
    const virtualBlocks = this.virtualBlocksForHostRange(range);
    if (virtualBlocks.length === 0) return undefined;
    const spans: number[] = [];
    let endOfLineState = ts.EndOfLineState.None;
    for (const virtualBlock of virtualBlocks) {
      const virtualFileName = virtualBlock.document.virtualFileName;
      const classifications = this.languageService.getEncodedSemanticClassifications(
        virtualFileName,
        { start: 0, length: virtualBlock.document.block.virtualText.length },
        ts.SemanticClassificationFormat.TwentyTwenty,
      );
      endOfLineState = classifications.endOfLineState;
      for (let index = 0; index + 2 < classifications.spans.length; index += 3) {
        const mapped = this.mapVirtualSpan(virtualFileName, {
          start: classifications.spans[index]!,
          length: classifications.spans[index + 1]!,
        });
        if (mapped === undefined || !spanIsInsideRange(mapped, range)) continue;
        spans.push(mapped.start, mapped.length, classifications.spans[index + 2]!);
      }
    }
    return { spans, endOfLineState };
  }

  getInlayHints(
    range: SourceRange,
    preferences: ts.UserPreferences = {},
  ): readonly SourceInlayHint[] {
    return this.virtualBlocksForHostRange(range).flatMap((virtualBlock) => {
      const virtualFileName = virtualBlock.document.virtualFileName;
      return this.languageService
        .provideInlayHints(
          virtualFileName,
          { start: 0, length: virtualBlock.document.block.virtualText.length },
          preferences,
        )
        .flatMap((hint) => {
          const position = mapVirtualOffset(virtualBlock.document.block, hint.position);
          if (position === undefined || position < range.start || position > range.end) return [];
          const displayParts = hint.displayParts?.flatMap((part) => {
            if (part.span === undefined || part.file === undefined) return [part];
            const span = this.mapVirtualSpan(part.file, part.span);
            return span === undefined
              ? []
              : [
                  {
                    ...part,
                    span: { start: span.start, length: span.length },
                    file: span.fileName,
                  },
                ];
          });
          if (
            hint.displayParts !== undefined &&
            displayParts?.length !== hint.displayParts.length
          ) {
            return [];
          }
          return [
            {
              hint,
              position: { fileName: virtualBlock.hostDocument.fileName, offset: position },
              displayParts,
            },
          ];
        });
    });
  }

  dispose(): void {
    this.languageService.dispose();
  }

  private rebuildVirtualDocuments(): void {
    this.virtualBlocks.clear();
    this.blocksByHost.clear();
    for (const document of this.documents.values()) {
      const blocks: VirtualBlock[] = [];
      for (const [index, block] of scanSourceBlocks(document.text, document.fileName).entries()) {
        if (!isTypeScriptLanguage(block.language)) continue;
        const virtualDocument = createSourceVirtualDocument(document.fileName, block, index);
        const virtualBlock = { document: virtualDocument, hostDocument: document };
        blocks.push(virtualBlock);
        this.virtualBlocks.set(virtualDocument.virtualFileName, virtualBlock);
      }
      if (blocks.length > 0) this.blocksByHost.set(document.fileName, blocks);
    }
    this.projectVersion += 1;
  }

  private createHost(): LanguageServiceHost {
    const host: LanguageServiceHost = {
      projectVersion: this.projectVersion,
      getCompilationSettings: () => this.options,
      getCurrentDirectory: () => this.currentDirectory,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      getScriptFileNames: () => [
        ...new Set([
          ...this.documents.keys(),
          ...this.projectFiles.keys(),
          ...this.virtualBlocks.keys(),
        ]),
      ],
      getScriptKind: (fileName) => {
        const virtualBlock = this.virtualBlocks.get(fileName);
        if (virtualBlock === undefined) return scriptKindForFileName(fileName);
        return virtualBlock.document.block.language === "ts" ? ts.ScriptKind.TS : ts.ScriptKind.JS;
      },
      getScriptSnapshot: (fileName) => {
        const virtualBlock = this.virtualBlocks.get(fileName);
        if (virtualBlock !== undefined) {
          return virtualBlock.document.virtualCode.snapshot;
        }
        const text = this.textFor(fileName) ?? ts.sys.readFile(fileName);
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
      },
      getScriptVersion: (fileName) => {
        const virtualBlock = this.virtualBlocks.get(fileName);
        if (virtualBlock !== undefined) {
          return `${this.versionFor(virtualBlock.hostDocument)}:${virtualBlock.document.block.virtualText}`;
        }
        return this.versionFor(this.documents.get(fileName) ?? this.projectFiles.get(fileName));
      },
      readFile: (fileName) => this.textFor(fileName) ?? ts.sys.readFile(fileName),
      fileExists: (fileName) => this.textFor(fileName) !== undefined || ts.sys.fileExists(fileName),
      readDirectory: (path, extensions, exclude, include, depth) =>
        ts.sys.readDirectory(path, extensions, exclude, include, depth),
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
      getProjectVersion: () => String(this.projectVersion),
    };
    return host;
  }

  private textFor(fileName: string): string | undefined {
    return (
      this.virtualBlocks.get(fileName)?.document.block.virtualText ??
      this.documents.get(fileName)?.text ??
      this.projectFiles.get(fileName)?.text
    );
  }

  private versionFor(document: SourceDocument | undefined): string {
    return document?.version === undefined ? "0" : String(document.version);
  }

  private findVirtualLocation(
    position: SourcePosition,
  ): { readonly block: VirtualBlock; readonly offset: number } | undefined {
    for (const block of this.blocksByHost.get(position.fileName) ?? []) {
      if (
        position.offset < block.document.block.bodyRange.start ||
        position.offset > block.document.block.bodyRange.end
      ) {
        continue;
      }
      const offset = mapHostOffset(block.document.block, position.offset);
      if (offset !== undefined) return { block, offset };
    }
    return undefined;
  }

  private mapHostRange(
    range: SourceRange,
  ): { readonly fileName: string; readonly start: number; readonly end: number } | undefined {
    const location = this.findVirtualLocation({ fileName: range.fileName, offset: range.start });
    if (location === undefined) return undefined;
    const block = location.block.document.block;
    if (range.fileName !== location.block.hostDocument.fileName) return undefined;
    if (rangeIntersectsSubstitution(block, range.start, range.end, "source")) return undefined;
    const mapped = mapSourceRange(block, { start: range.start, end: range.end });
    if (mapped === undefined) return undefined;
    return {
      fileName: location.block.document.virtualFileName,
      start: mapped.start,
      end: mapped.end,
    };
  }

  private virtualBlocksForHostRange(range: SourceRange): readonly VirtualBlock[] {
    return (this.blocksByHost.get(range.fileName) ?? []).filter((virtualBlock) => {
      const body = virtualBlock.document.block.bodyRange;
      return range.start <= body.end && body.start <= range.end;
    });
  }

  private mapVirtualSpan(fileName: string, span: ts.TextSpan): SourceSpan | undefined {
    const virtualBlock = this.virtualBlocks.get(fileName);
    if (virtualBlock === undefined) return { fileName, ...span };
    const block = virtualBlock.document.block;
    if (rangeIntersectsSubstitution(block, span.start, span.start + span.length, "virtual")) {
      return undefined;
    }
    if (span.length === 0) {
      const mapped = mapVirtualOffset(block, span.start);
      return mapped === undefined
        ? undefined
        : { fileName: virtualBlock.hostDocument.fileName, start: mapped, length: 0 };
    }
    const mapped = mapVirtualRange(block, {
      start: span.start,
      end: span.start + span.length,
    });
    return mapped === undefined
      ? undefined
      : {
          fileName: virtualBlock.hostDocument.fileName,
          start: mapped.start,
          length: mapped.end - mapped.start,
        };
  }

  private mapTextChanges(
    fileName: string,
    changes: readonly ts.TextChange[],
  ): readonly SourceTextChange[] {
    const mapped: SourceTextChange[] = [];
    for (const change of changes) {
      const span = this.mapVirtualSpan(fileName, change.span);
      if (span === undefined) return [];
      mapped.push({ ...span, newText: change.newText, data: change });
    }
    return mapped;
  }

  private mapFileTextChanges(
    changes: readonly ts.FileTextChanges[],
  ): readonly SourceTextChange[] | undefined {
    const mapped: SourceTextChange[] = [];
    for (const fileChanges of changes) {
      for (const change of fileChanges.textChanges) {
        const span = this.mapVirtualSpan(fileChanges.fileName, change.span);
        if (span === undefined) return undefined;
        mapped.push({ ...span, newText: change.newText, data: change });
      }
    }
    return mapped;
  }
}

function spanIsInsideRange(span: SourceSpan, range: SourceRange): boolean {
  return span.start >= range.start && span.start + span.length <= range.end;
}

function isTypeScriptLanguage(language: SourceLanguage): language is "js" | "ts" {
  return language === "js" || language === "ts";
}

function scriptKindForFileName(fileName: string): ts.ScriptKind {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lowerName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lowerName.endsWith(".ts")) return ts.ScriptKind.TS;
  if (lowerName.endsWith(".js")) return ts.ScriptKind.JS;
  return ts.ScriptKind.Unknown;
}
