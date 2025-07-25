const vscode = require('vscode');

let diagnosticsCollection;

function activate(context) {
    diagnosticsCollection = vscode.languages.createDiagnosticCollection('repeatedCode');

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
    const langs = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'csharp'];

    if (!langs.includes(document.languageId)) {
        diagnosticsCollection.delete(document.uri);
        return;
    }

    if (document.uri.fsPath.includes('node_modules')) {
        diagnosticsCollection.delete(document.uri);
        return;
    }

    const diagnostics = [];
    const text = document.getText();

    // Regex para métodos por linguagem
    const methodRegex = document.languageId === 'csharp'
        ? /\b(?:public|private|protected|internal)?\s*(?:async\s+)?(?:static\s+)?(?:[\w<>\[\]]+\s+)+(\w+)\s*\([^)]*\)\s*\{([\s\S]*?)(?=\n\s*\})/g
        : /(?:async\s+)?(?:[\w<>]+\s+)?(\w+)\s*\([^)]*\)\s*\{([\s\S]*?)(?=\n\s*\})/g;

    const controlWords = ['if', 'else', 'switch', 'break', 'try', 'catch', 'case', 'for', 'while', 'return', 'throw'];

    let match;
    while ((match = methodRegex.exec(text)) !== null) {
        const methodBodyStart = match.index;
        const methodName = match[1];
        const body = match[2];

        const lines = body.split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0 && !l.startsWith('//'));

        const seen = new Map();
        let searchOffset = methodBodyStart;

        for (const line of lines) {
            const hasControlKeyword = controlWords.some(keyword => line.includes(keyword));
            if (hasControlKeyword) continue;

            if (seen.has(line)) {
                // procurar a próxima ocorrência depois do offset atual
                const bodyIndex = text.indexOf(line, searchOffset);
                searchOffset = bodyIndex + line.length; // atualizar offset para próxima busca

                const startPos = document.positionAt(bodyIndex);
                const endPos = document.positionAt(bodyIndex + line.length);
                const range = new vscode.Range(startPos, endPos);

                diagnostics.push(new vscode.Diagnostic(
                    range,
                    `Esta linha está repetida dentro do método.`,
                    vscode.DiagnosticSeverity.Warning
                ));
            } else {
                seen.set(line, true);
            }
        }
    }

    diagnosticsCollection.set(document.uri, diagnostics);
}

module.exports = {
    activate,
    deactivate
};
