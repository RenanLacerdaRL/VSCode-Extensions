const vscode = require('vscode');

let diagnosticsCollection;

function activate(context) {
    diagnosticsCollection = vscode.languages.createDiagnosticCollection('noInlineNestedCalls');

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
    const lines = text.split('\n');

    // Expressão regular para encontrar chamadas de função aninhadas
    const nestedCallRegex = /\b\w+\([^)]*\b\w+\([^)]*\)[^)]*\)/g;
    // Expressão regular para encontrar 'new' dentro de chamadas (mantida do código original)
    const newInCallRegex = /\b\w+\([^)]*\bnew\s+\w+\s*\([^)]*\)[^)]*\)/g;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];

        // Verificar chamadas de função aninhadas
        checkNestedCalls(line, lineIndex, diagnostics, nestedCallRegex);

        // Manter a verificação de 'new' (código original)
        checkNewInCalls(line, lineIndex, diagnostics, newInCallRegex);
    }

    diagnosticsCollection.set(document.uri, diagnostics);
}

function checkNestedCalls(line, lineIndex, diagnostics, regex) {
    let match;
    while ((match = regex.exec(line)) !== null) {
        const fullMatch = match[0];
        const innerMatch = /\b\w+\([^)]*\)/.exec(fullMatch);

        if (!innerMatch) continue;

        const startIndex = match.index + innerMatch.index;
        const endIndex = startIndex + innerMatch[0].length;

        const startPos = new vscode.Position(lineIndex, startIndex);
        const endPos = new vscode.Position(lineIndex, endIndex);
        const range = new vscode.Range(startPos, endPos);

        diagnostics.push(
            new vscode.Diagnostic(
                range,
                'Chamada de função aninhada inline. Considere extrair para uma variável temporária para melhor legibilidade.',
                vscode.DiagnosticSeverity.Warning
            )
        );
    }
}

function checkNewInCalls(line, lineIndex, diagnostics, regex) {
    let match;
    while ((match = regex.exec(line)) !== null) {
        const fullMatch = match[0];
        const newMatch = /new\s+\w+\s*\([^)]*\)/.exec(fullMatch);

        if (!newMatch) continue;

        const startIndex = match.index + newMatch.index;
        const endIndex = startIndex + newMatch[0].length;

        const startPos = new vscode.Position(lineIndex, startIndex);
        const endPos = new vscode.Position(lineIndex, endIndex);
        const range = new vscode.Range(startPos, endPos);

        diagnostics.push(
            new vscode.Diagnostic(
                range,
                'Expressão "new" dentro de chamada de função. Considere extrair para uma variável temporária.',
                vscode.DiagnosticSeverity.Warning
            )
        );
    }
}

module.exports = {
    activate,
    deactivate
};
