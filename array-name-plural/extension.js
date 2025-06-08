const vscode = require('vscode');

let diagnosticsCollection;

function activate(context) {
  diagnosticsCollection = vscode.languages.createDiagnosticCollection('arrayNamePlural');

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

function updateDiagnostics(document) {
  const langs = [
    'typescript',
    'typescriptreact',
    'javascript',
    'javascriptreact',
    'csharp'
  ];
  if (!langs.includes(document.languageId)) {
    diagnosticsCollection.delete(document.uri);
    return;
  }

  const diagnostics = [];
  const text = document.getText();

  if (document.languageId.startsWith('typescript') || document.languageId.startsWith('javascript')) {
    // TS/JS: permitir espaços antes de "const|let|var" e detectar tipo array ou literal "["
    const tsArrayPattern = /^\s*(?:const|let|var)\s+(\w+)\s*(?::\s*([\w\<\>\[\]]+))?\s*=\s*(?:\[|new\s+Array<)/gm;
    let tsMatch;

    while ((tsMatch = tsArrayPattern.exec(text)) !== null) {
      const varName = tsMatch[1];
      const typeAnnotation = tsMatch[2] || '';
      const isArrayType =
        typeAnnotation.endsWith('[]') ||
        /^Array<.*>$/.test(typeAnnotation);
      const isArrayLiteral = /^\s*(?:const|let|var)\s+\w+\s*=\s*\[/.test(tsMatch[0]);

      if ((typeAnnotation && isArrayType) || isArrayLiteral) {
        if (!varName.endsWith('s')) {
          const idx = tsMatch.index + tsMatch[0].indexOf(varName);
          const startPos = document.positionAt(idx);
          const endPos = document.positionAt(idx + varName.length);
          const range = new vscode.Range(startPos, endPos);

          const diagnostic = new vscode.Diagnostic(
            range,
            `O nome "${varName}" deve ser plural (terminar com "s") porque é um array.`,
            vscode.DiagnosticSeverity.Warning
          );
          diagnostics.push(diagnostic);
        }
      }
    }
  } else if (document.languageId === 'csharp') {
    // C#: três padrões possíveis

    // 1) Tipo[] nome;
    const csPattern1 = /\b\w+\s*\[\]\s+(\w+)\b/g;
    let csMatch1;
    while ((csMatch1 = csPattern1.exec(text)) !== null) {
      const varName = csMatch1[1];
      if (!varName.endsWith('s')) {
        const idx = csMatch1.index + csMatch1[0].indexOf(varName);
        const startPos = document.positionAt(idx);
        const endPos = document.positionAt(idx + varName.length);
        const range = new vscode.Range(startPos, endPos);

        const diagnostic = new vscode.Diagnostic(
          range,
          `O nome "${varName}" deve ser plural (terminar com "s") porque é um array.`,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostics.push(diagnostic);
      }
    }

    // 2) List<...> nome;
    const csPattern2 = /\bList<[^>]+>\s+(\w+)\b/g;
    let csMatch2;
    while ((csMatch2 = csPattern2.exec(text)) !== null) {
      const varName = csMatch2[1];
      if (!varName.endsWith('s')) {
        const idx = csMatch2.index + csMatch2[0].indexOf(varName);
        const startPos = document.positionAt(idx);
        const endPos = document.positionAt(idx + varName.length);
        const range = new vscode.Range(startPos, endPos);

        const diagnostic = new vscode.Diagnostic(
          range,
          `O nome "${varName}" deve ser plural (terminar com "s") porque é um array.`,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostics.push(diagnostic);
      }
    }

    // 3) var nome = new List<...>();
    const csPattern3 = /\bvar\s+(\w+)\s*=\s*new\s+List<[^>]+>/g;
    let csMatch3;
    while ((csMatch3 = csPattern3.exec(text)) !== null) {
      const varName = csMatch3[1];
      if (!varName.endsWith('s')) {
        const idx = csMatch3.index + csMatch3[0].indexOf(varName);
        const startPos = document.positionAt(idx);
        const endPos = document.positionAt(idx + varName.length);
        const range = new vscode.Range(startPos, endPos);

        const diagnostic = new vscode.Diagnostic(
          range,
          `O nome "${varName}" deve ser plural (terminar com "s") porque é um array.`,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostics.push(diagnostic);
      }
    }
  }

  diagnosticsCollection.set(document.uri, diagnostics);
}

module.exports = {
  activate,
  deactivate
};
