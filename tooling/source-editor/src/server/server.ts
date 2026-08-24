import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CodeActionKind,
  CompletionItemKind,
  createConnection,
  DiagnosticSeverity,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  type CodeAction,
  type CompletionItem,
  type Diagnostic,
  type FormattingOptions,
  type InitializeResult,
  type Location,
  type Position,
  type Range,
  type SemanticTokens,
  type TextEdit,
  type WorkspaceEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import ts from "typescript";

import {
  createSourceLanguageService,
  type SourceDocument,
  type SourceLanguageService,
  type SourcePosition,
  type SourceSpan,
} from "./language-service.ts";
import {
  createWorkspaceLanguageService,
  type WorkspaceLanguageService,
} from "./workspace-language-service.ts";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const semanticTokensLegend = {
  tokenTypes: [
    "class",
    "enum",
    "interface",
    "namespace",
    "typeParameter",
    "type",
    "parameter",
    "variable",
    "enumMember",
    "property",
    "function",
    "method",
  ],
  tokenModifiers: ["declaration", "static", "async", "readonly", "defaultLibrary", "local"],
};
const inlayHintPreferences = {
  includeInlayParameterNameHints: "literals",
} satisfies ts.UserPreferences;
let languageService: SourceLanguageService = createSourceLanguageService({ documents: [] });
let workspaceLanguageService: WorkspaceLanguageService | undefined;

connection.onInitialize((params): InitializeResult => {
  const workspaceUri = params.workspaceFolders?.[0]?.uri ?? params.rootUri;
  if (workspaceUri !== null && workspaceUri !== undefined) {
    languageService.dispose();
    workspaceLanguageService = createWorkspaceLanguageService({
      directory: fileNameForUri(workspaceUri),
      warn: (message) => connection.console.warn(message),
    });
    languageService = workspaceLanguageService;
  }
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { triggerCharacters: ["."] },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      renameProvider: true,
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.Refactor] },
      semanticTokensProvider: {
        legend: semanticTokensLegend,
        range: true,
        full: true,
      },
      inlayHintProvider: true,
    },
  };
});

connection.onDidChangeWatchedFiles((params) => {
  workspaceLanguageService?.reloadProjects(
    params.changes.map((change) => fileNameForUri(change.uri)),
  );
  for (const document of documents.all()) publishDiagnostics(document);
});

documents.onDidOpen(({ document }) => {
  updateDocument(document);
  publishDiagnostics(document);
});

documents.onDidChangeContent(({ document }) => {
  updateDocument(document);
  publishDiagnostics(document);
});

documents.onDidClose(({ document }) => {
  languageService.removeDocument(fileNameForUri(document.uri));
  void connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
});

connection.onCompletion((params) => {
  const document = documents.get(params.textDocument.uri);
  if (document === undefined) return null;
  const result = languageService.getCompletions(toPosition(document, params.position));
  if (result === undefined) return null;
  return {
    isGlobalCompletion: result.info.isGlobalCompletion,
    isMemberCompletion: result.info.isMemberCompletion,
    isIncomplete: result.info.isIncomplete ?? false,
    items: result.items.map((item) => toCompletionItem(document, item)),
  };
});

connection.onHover((params) => {
  const document = documents.get(params.textDocument.uri);
  if (document === undefined) return null;
  const result = languageService.getHover(toPosition(document, params.position));
  if (result === undefined) return null;
  return {
    contents: {
      kind: "markdown" as const,
      value: result.info.displayParts?.map((part) => part.text).join("") ?? "",
    },
    range: toRange(document, result.range),
  };
});

connection.onDefinition((params) => {
  const document = documents.get(params.textDocument.uri);
  if (document === undefined) return [];
  return (languageService.getDefinitions(toPosition(document, params.position)) ?? []).map(
    (location) => toLocation(location),
  );
});

connection.onReferences((params) => {
  const document = documents.get(params.textDocument.uri);
  if (document === undefined) return [];
  return (languageService.getReferences(toPosition(document, params.position)) ?? []).map(
    (location) => toLocation(location),
  );
});

connection.onRenameRequest((params) => {
  const document = documents.get(params.textDocument.uri);
  if (document === undefined) return null;
  const result = languageService.getRename(toPosition(document, params.position), params.newName);
  const changes: Record<string, TextEdit[]> = {};
  for (const location of result.locations) {
    const uri = uriForFileName(location.fileName);
    (changes[uri] ??= []).push({
      range: toRange(documentForLocation(location.fileName, document), location),
      newText: params.newName,
    });
  }
  return { changes };
});

connection.onDocumentFormatting((params) => {
  const document = documents.get(params.textDocument.uri);
  if (document === undefined) return [];
  return languageService
    .getFormatting(
      fileNameForUri(document.uri),
      undefined,
      toFormattingSettings(document, params.options),
    )
    .map((change) => toTextEdit(documentForLocation(change.fileName, document), change));
});

connection.onDocumentRangeFormatting((params) => {
  const document = documents.get(params.textDocument.uri);
  if (document === undefined) return [];
  const range = toSourceRange(document, params.range);
  return languageService
    .getFormatting(
      fileNameForUri(document.uri),
      range,
      toFormattingSettings(document, params.options),
    )
    .map((change) => toTextEdit(documentForLocation(change.fileName, document), change));
});

connection.onCodeAction((params) => {
  const document = documents.get(params.textDocument.uri);
  if (document === undefined) return [];
  const range = toSourceRange(document, params.range);
  const actions = languageService.getCodeActions(
    range,
    params.context.diagnostics.flatMap((diagnostic) => {
      const code = Number(diagnostic.code);
      return Number.isInteger(code) ? [code] : [];
    }),
  );
  const quickFixes = actions.map(
    (action): CodeAction => ({
      title: action.action.description,
      kind: CodeActionKind.QuickFix,
      edit: toWorkspaceEdit(action.changes, document),
    }),
  );
  const refactors = languageService.getApplicableRefactors(range).flatMap((refactor) =>
    refactor.actions.flatMap((action): CodeAction[] => {
      const edits = languageService.getRefactorEdits(range, refactor.name, action.name);
      if (edits === undefined) return [];
      return [
        {
          title: action.description,
          kind: CodeActionKind.Refactor,
          edit: toWorkspaceEdit(edits.changes, document),
        },
      ];
    }),
  );
  return [...quickFixes, ...refactors];
});

connection.languages.semanticTokens.on((params): SemanticTokens | null => {
  const document = documents.get(params.textDocument.uri);
  if (document === undefined) return null;
  return semanticTokensFor(document, fullDocumentRange(document));
});

connection.languages.semanticTokens.onRange((params): SemanticTokens | null => {
  const document = documents.get(params.textDocument.uri);
  if (document === undefined) return null;
  return semanticTokensFor(document, params.range);
});

function semanticTokensFor(document: TextDocument, range: Range): SemanticTokens | null {
  const classifications = languageService.getSemanticClassifications(
    toSourceRange(document, range),
  );
  if (classifications === undefined) return null;
  return { data: encodeSemanticTokens(document, classifications.spans) };
}

connection.languages.inlayHint.on((params) => {
  const document = documents.get(params.textDocument.uri);
  if (document === undefined) return [];
  return languageService
    .getInlayHints(toSourceRange(document, params.range), inlayHintPreferences)
    .map((item) => ({
      position: document.positionAt(item.position.offset),
      label: item.displayParts?.map((part) => part.text).join("") ?? item.hint.text,
      kind: item.hint.kind === "Parameter" ? 2 : 1,
      paddingLeft: item.hint.whitespaceBefore,
      paddingRight: item.hint.whitespaceAfter,
    }));
});

function updateDocument(document: TextDocument): void {
  const sourceDocument: SourceDocument = {
    fileName: fileNameForUri(document.uri),
    text: document.getText(),
    version: document.version,
  };
  languageService.updateDocument(sourceDocument);
}

function publishDiagnostics(document: TextDocument): void {
  const diagnostics: Diagnostic[] = languageService
    .getDiagnostics(fileNameForUri(document.uri))
    .map((item) => ({
      severity: toDiagnosticSeverity(item.diagnostic.category),
      range: toRange(document, item),
      message: item.message,
      code: item.diagnostic.code,
      source: "typescript",
    }));
  void connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

function toPosition(document: TextDocument, position: Position): SourcePosition {
  return {
    fileName: fileNameForUri(document.uri),
    offset: document.offsetAt(position),
  };
}

function toSourceRange(document: TextDocument, range: Range) {
  return {
    fileName: fileNameForUri(document.uri),
    start: document.offsetAt(range.start),
    end: document.offsetAt(range.end),
  };
}

function toRange(document: TextDocument, span: SourceSpan): Range {
  return {
    start: document.positionAt(span.start),
    end: document.positionAt(span.start + span.length),
  };
}

function toTextEdit(document: TextDocument, change: SourceSpan & { newText: string }): TextEdit {
  return { range: toRange(document, change), newText: change.newText };
}

function toLocation(location: SourceSpan): Location {
  const document = documentForFileName(location.fileName);
  return {
    uri: uriForFileName(location.fileName),
    range:
      document === undefined
        ? {
            start: { line: 0, character: location.start },
            end: { line: 0, character: location.start + location.length },
          }
        : toRange(document, location),
  };
}

function toCompletionItem(
  document: TextDocument,
  item: {
    readonly entry: ts.CompletionEntry;
    readonly replacementSpan?: SourceSpan;
  },
): CompletionItem {
  const completion: CompletionItem = {
    label: item.entry.name,
    kind: CompletionItemKind.Text,
    sortText: item.entry.sortText,
    filterText: item.entry.filterText,
    insertText: item.entry.insertText,
    detail: item.entry.kindModifiers,
  };
  if (item.replacementSpan === undefined) return completion;
  return {
    ...completion,
    textEdit: {
      range: toRange(document, item.replacementSpan),
      newText: item.entry.insertText ?? item.entry.name,
    },
  };
}

function toFormattingSettings(
  document: TextDocument,
  options: FormattingOptions,
): ts.FormatCodeSettings {
  return {
    ...ts.getDefaultFormatCodeSettings(),
    convertTabsToSpaces: options.insertSpaces,
    indentSize: options.tabSize,
    tabSize: options.tabSize,
    newLineCharacter: document.getText().includes("\r\n") ? "\r\n" : "\n",
  };
}

function toWorkspaceEdit(
  changes: readonly (SourceSpan & { newText: string })[],
  activeDocument: TextDocument,
): WorkspaceEdit {
  const result: Record<string, TextEdit[]> = {};
  for (const change of changes) {
    const document = documentForLocation(change.fileName, activeDocument);
    const uri = uriForFileName(change.fileName);
    (result[uri] ??= []).push(toTextEdit(document, change));
  }
  return { changes: result };
}

function documentForLocation(fileName: string, fallback: TextDocument): TextDocument {
  return documentForFileName(fileName) ?? fallback;
}

function documentForFileName(fileName: string): TextDocument | undefined {
  const uri = uriForFileName(fileName);
  const openDocument = documents.get(uri);
  if (openDocument !== undefined) return openDocument;
  try {
    return TextDocument.create(
      uri,
      languageIdForFileName(fileName),
      0,
      readFileSync(fileName, "utf8"),
    );
  } catch {
    return undefined;
  }
}

function languageIdForFileName(fileName: string): string {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".tsx")) return "typescriptreact";
  if (lowerName.endsWith(".jsx")) return "javascriptreact";
  if (lowerName.endsWith(".ts") || lowerName.endsWith(".mts") || lowerName.endsWith(".cts")) {
    return "typescript";
  }
  return "javascript";
}

function fullDocumentRange(document: TextDocument): Range {
  return {
    start: { line: 0, character: 0 },
    end: document.positionAt(document.getText().length),
  };
}

function encodeSemanticTokens(document: TextDocument, spans: readonly number[]): number[] {
  const tokens: number[] = [];
  let previousLine = 0;
  let previousCharacter = 0;
  for (let index = 0; index + 2 < spans.length; index += 3) {
    const classification = spans[index + 2]!;
    const tokenType = (classification >> 8) - 1;
    if (tokenType < 0 || tokenType >= semanticTokensLegend.tokenTypes.length) continue;
    const position = document.positionAt(spans[index]!);
    const deltaLine = position.line - previousLine;
    const deltaCharacter =
      deltaLine === 0 ? position.character - previousCharacter : position.character;
    tokens.push(deltaLine, deltaCharacter, spans[index + 1]!, tokenType, classification & 255);
    previousLine = position.line;
    previousCharacter = position.character;
  }
  return tokens;
}

function toDiagnosticSeverity(category: number): DiagnosticSeverity {
  if (category === 1) return DiagnosticSeverity.Error;
  if (category === 2) return DiagnosticSeverity.Warning;
  if (category === 3) return DiagnosticSeverity.Information;
  return DiagnosticSeverity.Hint;
}

function fileNameForUri(uri: string): string {
  return uri.startsWith("file://") ? fileURLToPath(uri) : uri;
}

function uriForFileName(fileName: string): string {
  return fileName.startsWith("file://") ? fileName : pathToFileURL(fileName).toString();
}

documents.listen(connection);
connection.listen();
