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
    const supportedLangs = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'csharp'];
    if (!supportedLangs.includes(document.languageId)) {
        diagnosticsCollection.delete(document.uri);
        return;
    }

    const config = vscode.workspace.getConfiguration('inlineFunctionCall');
    const considerLocals = config.get('considerLocalVariables', true);
    const considerParams = config.get('considerParameters', true);
    const ignoreMethods = new Set(config.get('ignoreMethods', []));

    const lines = document.getText().split('\n');
    const diagnostics = [];

    const importedNames = new Set();
    const importRegex = /^\s*import\s+{([^}]+)}\s+from\s+['"][^'"]+['"]/;
    for (const line of lines) {
        const m = importRegex.exec(line);
        if (m) {
            m[1].split(',').forEach(name => {
                importedNames.add(name.trim());
            });
        }
    }

    const localNames = new Set();
    const paramNames = new Set();
    const varDeclRegex = /^\s*(?:const|let|var)\s+([A-Za-z_$]\w*)/;
    const methodSigRegex = /^\s*(?:public\s+|private\s+|protected\s+)?(?:static\s+)?[A-Za-z_$]\w*\s*\(([^)]*)\)\s*{/;
    for (const line of lines) {
        let m;
        if (considerLocals && (m = varDeclRegex.exec(line))) {
            localNames.add(m[1]);
        }
        if (considerParams && (m = methodSigRegex.exec(line))) {
            const params = m[1]
                .split(',')
                .map(p => p.split(/[:=]/)[0].trim())
                .filter(p => p);
            params.forEach(p => paramNames.add(p));
        }
    }

    const nestedCallRegex = /\b\w+\s*\((?:[^()]*\b\w+\s*\([^()]*\)[^()]*)+\)/g;
    const controlStructRegex = /^\s*(if|for|while|switch)\b/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (controlStructRegex.test(line) || line.includes('=>')) continue;

        const codeLine = line
            .replace(/(['"`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, str => ' '.repeat(str.length)) // ignora strings
            .replace(/\/(?![/*])(?:\\.|[^/\\])+\/[gimsuy]*/g, m => ' '.repeat(m.length))     // ignora regex
            .replace(/\/\/.*$/g, m => ' '.repeat(m.length)); // ignora comentários de linha

        let match;
        while ((match = nestedCallRegex.exec(codeLine)) !== null) {
            const snippet = match[0];
            const openParens = (snippet.match(/\(/g) || []).length;
            let shouldIgnore = false;

            // 1) Ignorar se for método da lista ignoreMethods (inclui 'new')
            for (const name of ignoreMethods) {
                const re = new RegExp(`^(?:new\\s+)?${name}\\s*\\(`);
                if (re.test(snippet)) {
                    shouldIgnore = true;
                    break;
                }
            }
            if (shouldIgnore) continue;

            // 2) Ignorar se vier de variável local
            if (considerLocals) {
                for (const name of localNames) {
                    if (new RegExp(`\\b${name}\\s*\\.`, 'g').test(snippet)) {
                        shouldIgnore = true;
                        break;
                    }
                }
            }
            if (!shouldIgnore && considerParams) {
                for (const name of paramNames) {
                    if (new RegExp(`\\b${name}\\s*\\.`, 'g').test(snippet)) {
                        shouldIgnore = true;
                        break;
                    }
                }
            }
            if (shouldIgnore) continue;

            // 3) Ignorar chamadas diretas de imports (se só tiver um parêntese)
            if (openParens === 1) {
                for (const name of importedNames) {
                    const re = new RegExp(`^(?:new\\s+)?${name}\\s*\\(`);
                    if (re.test(snippet)) {
                        shouldIgnore = true;
                        break;
                    }
                }
                if (shouldIgnore) continue;
            }

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
