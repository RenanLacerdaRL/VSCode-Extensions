const vscode = require('vscode');

let diagnosticsCollection;

function activate(context) {
    diagnosticsCollection = vscode.languages.createDiagnosticCollection('variable-names');

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

    // Carrega lista de palavras para ignorar das configurações do usuário
    const config = vscode.workspace.getConfiguration('rl.variable-names');
    const ignoreList = config.get('ignoreWords', []);

    const diagnostics = [];
    const text = document.getText();

    // helper interno para adicionar diagnostic
    function addDiagnostic(varName, idx, message = null) {
        const startPos = document.positionAt(idx);
        const endPos = document.positionAt(idx + varName.length);
        const range = new vscode.Range(startPos, endPos);

        diagnostics.push(new vscode.Diagnostic(
            range,
            message || `Variável "${varName}" é um array e deve ter nome no plural (terminar com "s").`,
            vscode.DiagnosticSeverity.Warning
        ));
    }

    if (document.languageId.startsWith('typescript') || document.languageId.startsWith('javascript')) {
        // 1) Locais: const|let|var com array literal ou Array<> tipado
        const tsPattern = /^\s*(?:const|let|var)\s+(\w+)\s*(?::\s*([^=;]+))?\s*=\s*(?:\[|new\s+Array<)/gm;
        let match;

        while ((match = tsPattern.exec(text)) !== null) {
            const varName = match[1];
            if (!varName.endsWith('s')) {
                const idx = match.index + match[0].indexOf(varName);
                addDiagnostic(varName, idx);
            }
        }

        // 2) Campos de classe tipados: por exemplo, private popupAction: PoPopupAction[];
        const classFieldPattern = /^\s*(?:public|protected|private)?\s*(?:readonly\s*)?(\w+)\s*:\s*[\w<>\[\]]+\[\]\s*(?:[=;]|$)/gm;

        while ((match = classFieldPattern.exec(text)) !== null) {
            const varName = match[1];
            if (!varName.endsWith('s')) {
                const idx = match.index + match[0].indexOf(varName);
                addDiagnostic(varName, idx);
            }
        }

        // 3) Verifica se o nome da variável tem relação com a chamada
        const usagePattern = /^\s*(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?([^;\n]+)/gm;
        while ((match = usagePattern.exec(text)) !== null) {
            const varName = match[1];
            const expression = match[2].trim();

            // Ignorar literais simples (números, strings, booleanos)
            if (/^(?:\d+(?:\.\d+)?|'.*'|".*"|true|false)$/.test(expression)) {
                continue;
            }

            // Ignorar se expressão ou variável contiver palavra da lista de ignorados
            const lowerExpr = expression.toLowerCase();
            const lowerVar = varName.toLowerCase();
            if (ignoreList.some(w => {
                const lw = w.toLowerCase();
                return lowerExpr.includes(lw) || lowerVar.includes(lw);
            })) {
                continue;
            }

            // separa nome da variável em partes (camelCase, underscore)
            const varParts = varName
                .split(/(?=[A-Z])|_/)
                .map(p => p.toLowerCase())
                .filter(Boolean);

            // limpa e separa expressão em palavras-chave
            const exprClean = expression.replace(/\bawait\b/g, '').trim();
            const exprParts = exprClean
                .split(/[^a-zA-Z0-9]+/)
                .map(p => p.toLowerCase())
                .filter(Boolean);

            const hasRelation = varParts.some(vp =>
                exprParts.some(ep => ep.includes(vp) || vp.includes(ep))
            );

            if (!hasRelation) {
                const idx = match.index + match[0].indexOf(varName);
                addDiagnostic(
                    varName,
                    idx,
                    `A variável "${varName}" não tem relação aparente com a expressão usada na atribuição.`
                );
            }
        }

    } else if (document.languageId === 'csharp') {
        // C#: detecção unificada de arrays e coleções genéricas em campos e var
        const csPatterns = [
            // T[] name;
            /\b[\w<>\.]+\s*\[\]\s+(\w+)\b/g,
            // List<...> name; IList<...> etc.
            /\b(?:List|IList|IEnumerable|Collection)<[^>]+>\s+(\w+)\b/g,
            // var name = new T[...] or new List<...>();
            /\bvar\s+(\w+)\s*=\s*new\s+[\w<>\.\[\]]+\s*(?:\(|\[)/g
        ];

        for (const pattern of csPatterns) {
            let m;

            while ((m = pattern.exec(text)) !== null) {
                const varName = m[1];

                if (!varName.endsWith('s')) {
                    const idx = m.index + m[0].indexOf(varName);
                    addDiagnostic(varName, idx);
                }
            }
        }
    }

    diagnosticsCollection.set(document.uri, diagnostics);
}

module.exports = {
    activate,
    deactivate
};
