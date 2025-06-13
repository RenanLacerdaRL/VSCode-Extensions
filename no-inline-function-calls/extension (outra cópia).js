const vscode = require('vscode');

let diagnosticsCollection;

function activate(context) {
    diagnosticsCollection = vscode.languages.createDiagnosticCollection('inlineFunctionCall');

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
    if (diagnosticsCollection) diagnosticsCollection.dispose();
}

function updateDiagnostics(document) {
    const supportedLangs = ['typescript','typescriptreact','javascript','javascriptreact','csharp'];
    if (!supportedLangs.includes(document.languageId)) {
        diagnosticsCollection.delete(document.uri);
        return;
    }

    const lines = document.getText().split('\n');
    const diagnostics = [];

    const nestedCallRegex = /\b\w+\s*\((?:[^()]*\b\w+\s*\([^()]*\)[^()]*)+\)/g;
    const controlStructRegex = /^\s*(if|for|while|switch)\b/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (controlStructRegex.test(line)) continue;
        if (line.includes('=>')) continue;

        const codeLine = line.replace(/"([^"\\]|\\.)*"/g, str => ' '.repeat(str.length));

        let match;
        while ((match = nestedCallRegex.exec(codeLine)) !== null) {
            const snippet = match[0];
            const openParens = (snippet.match(/\(/g) || []).length;
            if (openParens >= 2) {
                diagnostics.push(createDiag(
                    i,
                    match.index,
                    snippet.length,
                    'Considere extrair a função interna para uma variável antes.'
                ));
            }
        }
    }

    diagnosticsCollection.set(document.uri, diagnostics);
}

function createDiag(line, chStart, length, message) {
    const range = new vscode.Range(
        new vscode.Position(line, chStart),
        new vscode.Position(line, chStart + length)
    );
    return new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
}

module.exports = { activate, deactivate };
