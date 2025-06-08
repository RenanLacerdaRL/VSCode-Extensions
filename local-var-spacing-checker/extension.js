const vscode = require('vscode');

let diagnosticsCollection;

function activate(context) {
    diagnosticsCollection = vscode.languages.createDiagnosticCollection('localVarSpacing');

    const updateDiagnostics = (document) => {
        if (!document) return;

        const supportedLanguages = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'csharp'];
        if (!supportedLanguages.includes(document.languageId)) {
            diagnosticsCollection.delete(document.uri);
            return;
        }

        const diagnostics = [];
        const text = document.getText();
        const lines = text.split('\n');

        // Regex melhorada para variáveis locais
        const varRegex = {
            csharp: /^\s*(?:var|int|float|string|bool|Vector\d|GameObject)\s+\w+/i,
            typescript: /^\s*(?:const|let|var)\s+\w+/i,
            javascript: /^\s*(?:const|let|var)\s+\w+/i
        };

        // Regex para métodos/funções
        const methodRegex = {
            csharp: /^\s*(?:public|private|protected|internal)?\s*(?:static\s+)?(?:async\s+)?[^{]+{\s*$/,
            typescript: /^\s*(?:public|private|protected)?\s*(?:async\s+)?\s*\w+\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{?\s*$/,
            javascript: /^\s*(?:async\s+)?\s*(?:function\s*)?\w*\s*\([^)]*\)\s*\{?\s*$/
        };

        let inMethod = false;
        let methodStartLine = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Detecta início do método
            if (!inMethod && line.match(methodRegex[document.languageId] || methodRegex.default)) {
                inMethod = true;
                methodStartLine = i;
                continue;
            }

            // Detecta fim do método
            if (inMethod && line.includes('}')) {
                inMethod = false;
                continue;
            }

            if (inMethod) {
                const isLocalVar = line.match(varRegex[document.languageId] || varRegex.default);

                if (isLocalVar) {
                    const nextLineIndex = i + 1;
                    if (nextLineIndex < lines.length) {
                        const nextLine = lines[nextLineIndex].trim();
                        const nextIsVar = nextLine.match(varRegex[document.languageId] || varRegex.default);
                        const nextIsBlockEnd = nextLine.includes('}');
                        const nextIsComment = nextLine.startsWith('//') || nextLine.startsWith('/*');

                        if (!nextIsVar && !nextIsBlockEnd && !nextIsComment && nextLine !== '') {
                            const range = new vscode.Range(
                                new vscode.Position(i, 0),
                                new vscode.Position(i, line.length)
                            );

                            diagnostics.push(new vscode.Diagnostic(
                                range,
                                'Adicione uma linha em branco após declaração de variável local',
                                vscode.DiagnosticSeverity.Warning
                            ));
                        }
                    }
                }
            }
        }

        diagnosticsCollection.set(document.uri, diagnostics);
    };

    // Configuração inicial
    if (vscode.window.activeTextEditor) {
        updateDiagnostics(vscode.window.activeTextEditor.document);
    }

    // Listeners
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

module.exports = {
    activate,
    deactivate
};
