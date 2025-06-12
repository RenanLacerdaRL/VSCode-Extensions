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
        const lines = document.getText().split('\n');

        const varStartRegex = {
            typescript: /^\s*(const|let|var)\s+/,
            javascript: /^\s*(const|let|var)\s+/,
            csharp:    /^\s*(var|[A-Za-z_]\w*(<.*>)?(\[\])?)\s+\w+/
        };

        const langId = document.languageId.startsWith('typescript') ? 'typescript' :
                      document.languageId.startsWith('javascript')  ? 'javascript'  : 'csharp';
        const varPattern = varStartRegex[langId];

        for (let i = 0; i < lines.length - 1; i++) {
            const line    = lines[i];
            const trimmed = line.trim();

            // Em C#, ignora linhas não indentadas (fora de métodos)
            if (langId === 'csharp' && line === trimmed) continue;
            // Em C#, ignora assinaturas de método (linhas que terminam com '{' e contêm parênteses)
            if (langId === 'csharp' && trimmed.endsWith('{') && trimmed.includes('(') && trimmed.includes(')')) continue;

            if (!varPattern.test(trimmed)) continue;

            // Procurar até encontrar o ponto e vírgula que encerra a declaração
            let j = i;
            let foundSemicolon = false;
            while (j < lines.length) {
                if (lines[j].trim().endsWith(';')) {
                    foundSemicolon = true;
                    break;
                }
                j++;
            }

            if (!foundSemicolon || j >= lines.length - 1) continue;

            // Se o ';' pertencer a um return, ignora este caso
            const semicolonLine = lines[j].trim();
            if (semicolonLine.startsWith('return')) {
                i = j;
                continue;
            }

            const nextLine = lines[j + 1].trim();
            const isNextLineAnotherVar = varPattern.test(nextLine);
            const isNextLineComment    = nextLine.startsWith('//') || nextLine.startsWith('/*');
            const isNextLineReturn     = nextLine.startsWith('return');

            if (nextLine !== '' && !isNextLineAnotherVar && !isNextLineComment && !isNextLineReturn) {
                const range = new vscode.Range(
                    new vscode.Position(i, 0),
                    new vscode.Position(i, line.length)
                );
                diagnostics.push(new vscode.Diagnostic(
                    range,
                    'Adicione uma linha em branco após declaração de variável local.',
                    vscode.DiagnosticSeverity.Warning
                ));
            }

            i = j; // pular até a linha onde terminou a declaração
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
        vscode.workspace.onDidChangeTextDocument(event => {
            updateDiagnostics(event.document);
        }),
        diagnosticsCollection
    );
}

function deactivate() {
    if (diagnosticsCollection) {
        diagnosticsCollection.dispose();
    }
}

module.exports = {
    activate,
    deactivate
};
