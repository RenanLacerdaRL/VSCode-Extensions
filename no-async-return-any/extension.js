const vscode = require('vscode');

let diagnosticsCollection;

function activate(context) {
  diagnosticsCollection = vscode.languages.createDiagnosticCollection('noAsyncReturnAny');

  if (vscode.window.activeTextEditor) {
    updateDiagnostics(vscode.window.activeTextEditor.document);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) updateDiagnostics(editor.document);
    }),
    vscode.workspace.onDidChangeTextDocument(e => {
      updateDiagnostics(e.document);
    }),
    diagnosticsCollection
  );
}

function deactivate() {
  if (diagnosticsCollection) {
    diagnosticsCollection.dispose();
  }
}

function analyzeTypeScript(text, document) {
  const diagnostics = [];

  // Regex para localizar funções async
  const asyncFuncRegex = /async function\s+(\w*)\s*\(([^)]*)\)/g;
  let match;

  while ((match = asyncFuncRegex.exec(text)) !== null) {
    const params = match[2]; // parâmetros da função

    // Verifica se algum parâmetro tem tipo any
    if (/\bany\b/.test(params)) {
      const funcStart = match.index;
      const position = document.positionAt(funcStart);
      const range = new vscode.Range(position, document.positionAt(funcStart + match[0].length));

      diagnostics.push(new vscode.Diagnostic(
        range,
        'Função async não deve usar parâmetro com tipo any (possível retorno any).',
        vscode.DiagnosticSeverity.Warning
      ));
    }
  }

  // Também verificar arrow functions async
  // Ex: const fn = async (param: any) => { ... }
  const asyncArrowFuncRegex = /async\s*\(([^)]*)\)\s*=>/g;
  while ((match = asyncArrowFuncRegex.exec(text)) !== null) {
    const params = match[1];
    if (/\bany\b/.test(params)) {
      const funcStart = match.index;
      const position = document.positionAt(funcStart);
      const range = new vscode.Range(position, document.positionAt(funcStart + match[0].length));

      diagnostics.push(new vscode.Diagnostic(
        range,
        'Função async não deve usar parâmetro com tipo any (possível retorno any).',
        vscode.DiagnosticSeverity.Warning
      ));
    }
  }

  return diagnostics;
}

function analyzeCSharp(text, document) {
  const diagnostics = [];

  const asyncMethodRegex = /async\s+(?:\w+\s+)+(\w+)\s*\([^)]*\)/g;
  let match;

  while ((match = asyncMethodRegex.exec(text)) !== null) {
    const params = match[0];
    // Detectar parâmetros tipo 'object' ou 'dynamic'
    if (/\b(dynamic|object)\b/.test(params)) {
      const methodStart = match.index;
      const position = document.positionAt(methodStart);
      const range = new vscode.Range(position, document.positionAt(methodStart + match[0].length));

      diagnostics.push(new vscode.Diagnostic(
        range,
        'Função async não deve usar parâmetro com tipo dynamic ou object (possível retorno any).',
        vscode.DiagnosticSeverity.Warning
      ));
    }
  }

  return diagnostics;
}

function updateDiagnostics(document) {
  if (!['typescript', 'typescriptreact', 'csharp'].includes(document.languageId)) {
    diagnosticsCollection.delete(document.uri);
    return;
  }

  const text = document.getText();
  let diagnostics = [];

  if (document.languageId.startsWith('typescript')) {
    diagnostics = analyzeTypeScript(text, document);
  } else if (document.languageId === 'csharp') {
    diagnostics = analyzeCSharp(text, document);
  }

  diagnosticsCollection.set(document.uri, diagnostics);
}

module.exports = {
  activate,
  deactivate
};
