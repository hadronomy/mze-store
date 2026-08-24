import * as vscode from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

import { scanSourceBlocks } from "~/core/index";
import {
  getInactiveLiteralRanges,
  type OffsetRange,
  type SourceBlockRanges,
} from "./inactive-ranges.ts";

const sourceLanguages = new Set(["javascript", "javascriptreact", "typescript", "typescriptreact"]);

const inactiveOpacity = "0.72";

/**
 * Starts the source language server and the cursor-aware source decorations.
 * All resources created during activation belong to the extension context.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const decorationType = vscode.window.createTextEditorDecorationType({
    opacity: inactiveOpacity,
  });

  const refreshDecorations = createDecorationRefresher(decorationType);
  const refreshOpenEditors = () => refreshDecorations();

  context.subscriptions.push(
    decorationType,
    vscode.window.onDidChangeActiveTextEditor(refreshOpenEditors),
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      refreshDecorations(document);
    }),
    vscode.window.onDidChangeTextEditorSelection(refreshOpenEditors),
    vscode.window.onDidChangeActiveColorTheme(refreshOpenEditors),
  );

  refreshOpenEditors();

  const serverModule = context.asAbsolutePath("dist/server.cjs");
  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "javascript" },
      { scheme: "file", language: "javascriptreact" },
      { scheme: "file", language: "typescript" },
      { scheme: "file", language: "typescriptreact" },
    ],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher(
        "**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,json}",
      ),
    },
  };
  const client = new LanguageClient(
    "mze-source-language-server",
    "MZE Source Language Server",
    serverOptions,
    clientOptions,
  );

  context.subscriptions.push(client);
  await client.start();
}

function createDecorationRefresher(
  decorationType: vscode.TextEditorDecorationType,
): (document?: vscode.TextDocument) => void {
  return (document) => {
    const highContrast = isHighContrastTheme(vscode.window.activeColorTheme);
    const editors = vscode.window.visibleTextEditors.filter(
      (editor) => (!document || editor.document === document) && isSourceDocument(editor.document),
    );

    for (const editor of editors) {
      editor.setDecorations(decorationType, getDecorationOptions(editor, highContrast));
    }
  };
}

function getDecorationOptions(
  editor: vscode.TextEditor,
  highContrast: boolean,
): readonly vscode.DecorationOptions[] {
  const document = editor.document;
  const selections = editor.selections.map((selection) => ({
    start: document.offsetAt(selection.start),
    end: document.offsetAt(selection.end),
  }));
  const blocks = scanSourceBlocks(document.getText(), document.fileName);
  const decorations: vscode.DecorationOptions[] = [];

  for (const block of blocks) {
    const inactiveRanges = getInactiveLiteralRanges(
      {
        bodyRange: block.bodyRange,
        literalRanges: block.literalRanges.map((mapping) => mapping.source),
      },
      selections,
      highContrast,
    );

    for (const range of inactiveRanges) {
      decorations.push({ range: toDocumentRange(document, range) });
    }
  }

  return decorations;
}

function toDocumentRange(document: vscode.TextDocument, range: OffsetRange): vscode.Range {
  return new vscode.Range(document.positionAt(range.start), document.positionAt(range.end));
}

function isSourceDocument(document: vscode.TextDocument): boolean {
  return sourceLanguages.has(document.languageId);
}

function isHighContrastTheme(theme: vscode.ColorTheme): boolean {
  return (
    theme.kind === vscode.ColorThemeKind.HighContrast ||
    theme.kind === vscode.ColorThemeKind.HighContrastLight
  );
}

export type { SourceBlockRanges };
