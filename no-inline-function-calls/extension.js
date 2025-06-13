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

    // 🚩 Configurações
    const config = vscode.workspace.getConfiguration('inlineFunctionCall');
    const considerLocals = config.get('considerLocalVariables', true);
    const considerParams = config.get('considerParameters', true);
    const ignoreMethods = new Set(config.get('ignoreMethods', []));

    const lines = document.getText().split('\n');
    const diagnostics = [];

    // coletar métodos importados para também ignorar
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

    // coletar nomes de variáveis locais e parâmetros de métodos
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
        const codeLine = line.replace(/"([^"\\]|\\.)*"/g, str => ' '.repeat(str.length));

        let match;
        while ((match = nestedCallRegex.exec(codeLine)) !== null) {
            const snippet = match[0];
            const openParens = (snippet.match(/\(/g) || []).length;
            let shouldIgnore = false;

            // 1) ignorar se for método listado em ignoreMethods (inclui 'new')
            for (const name of ignoreMethods) {
                const re = new RegExp(`^(?:new\\s+)?${name}\\s*\\(`);
                if (re.test(snippet)) {
                    shouldIgnore = true;
                    break;
                }
            }
            if (shouldIgnore) continue;

            // 2) ignorar se vier de variável local ou parâmetro conforme config
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

            // 3) ignorar chamadas diretas de import **somente se não for nested**
            //    ou seja, se houver apenas 1 parêntese
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

            // agora, se for nested (openParens >= 2), avisamos
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
