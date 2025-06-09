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

        const varRegex = {
            csharp: /^\s*(?:var|[A-Za-z_]\w*(?:<[\w<>;, ]+>)?)(\[\])?\s+\w+/,
            typescript: /^\s*(?:const|let|var)\s+\w+/i,
            javascript: /^\s*(?:const|let|var)\s+\w+/i
        };

        const methodRegex = {
            csharp: /^\s*(?:public|private|protected|internal)?\s*(?:static\s+)?(?:async\s+)?\s*\w[\w<>]*\s+\w+\s*\([^)]*\)\s*\{?\s*$/,
            typescript: /^\s*(?:public|private|protected)?\s*(?:async\s+)?\s*\w+\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{?\s*$/,
            javascript: /^\s*(?:async\s+)?\s*(?:function\s*)?\w*\s*\([^)]*\)\s*\{?\s*$/
        };

        const langId = document.languageId;
        const varPattern = varRegex[langId];
        const methodPattern = methodRegex[langId];

        let inMethod = false;

        for (let i = 0; i < lines.length - 1; i++) {
            const rawLine = lines[i];
            const line = rawLine.trim();
            const nextLine = lines[i + 1].trim();

            if (
                !inMethod &&
                (
                    (methodPattern && line.match(methodPattern)) ||
                    line.startsWith('for') ||
                    line.startsWith('foreach') ||
                    line.startsWith('while') ||
                    line.startsWith('if') ||
                    line.startsWith('switch')
                )
            ) {
                inMethod = true;
                continue;
            }

            if (inMethod && line === '}') {
                inMethod = false;
                continue;
            }

            if (inMethod && varPattern && line.match(varPattern) && !rawLine.includes('=>')) {
                // Novo ajuste para ignorar aviso após controle
                const prevLine = lines[i - 1]?.trim() || '';
                const isAfterControl = /^(return|if|else|do|while|for|switch|catch|try|throw|case|default)\b/.test(prevLine) || line.startsWith('case') || line.startsWith('default') || nextLine.startsWith('break');

                if (isAfterControl) continue;

                const nextIsVar = nextLine.match(varPattern);
                const nextIsBlockEnd = nextLine === '}' || nextLine === '';
                const nextIsComment = nextLine.startsWith('//') || nextLine.startsWith('/*');

                if (!nextIsVar && !nextIsBlockEnd && !nextIsComment) {
                    const range = new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, rawLine.length));

                    diagnostics.push(new vscode.Diagnostic(
                        range,
                        'Adicione uma linha em branco após declaração de variável local.',
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
            }
        }

        diagnosticsCollection.set(document.uri, diagnostics);
    };

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

module.exports = {
    activate,
    deactivate
};
