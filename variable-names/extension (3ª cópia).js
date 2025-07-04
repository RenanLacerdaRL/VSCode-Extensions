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

    const config = vscode.workspace.getConfiguration('rl.variable-names');
    const ignoreList = config.get('ignoreWords', []);

    const diagnostics = [];
    const text = document.getText();

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
        const tsPattern = /^\s*(?:const|let|var)\s+(\w+)\s*(?::\s*([^=;]+))?\s*=\s*(?:\[|new\s+Array<)/gm;
        let match;

        while ((match = tsPattern.exec(text)) !== null) {
            const varName = match[1];
            if (!varName.endsWith('s')) {
                const idx = match.index + match[0].indexOf(varName);
                addDiagnostic(varName, idx);
            }
        }

        const classFieldPattern = /^\s*(?:public|protected|private)?\s*(?:readonly\s*)?(\w+)\s*:\s*[\w<>\[\]]+\[\]\s*(?:[=;]|$)/gm;

        while ((match = classFieldPattern.exec(text)) !== null) {
            const varName = match[1];
            if (!varName.endsWith('s')) {
                const idx = match.index + match[0].indexOf(varName);
                addDiagnostic(varName, idx);
            }
        }

        const usagePattern = /^\s*(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?([^;\n]+)/gm;
        while ((match = usagePattern.exec(text)) !== null) {
            const varName = match[1];
            const expression = match[2].trim();

            // 1) Ignorar literais simples
            if (/^(?:\d+(?:\.\d+)?|'.*'|".*"|true|false)$/.test(expression)) {
                continue;
            }

            // 2) Ignorar se estiver na lista de exceções
            const lowerExpr = expression.toLowerCase();
            const lowerVar = varName.toLowerCase();
            if (ignoreList.some(w => {
                const lw = w.toLowerCase();
                return lowerExpr.includes(lw) || lowerVar.includes(lw);
            })) {
                continue;
            }

            // 3) Novo: ignora se o objeto antes do . for singular da variável + 's'
            const objMatch = expression.match(/^([A-Za-z0-9_]+)\./);
            if (objMatch) {
                const objName = objMatch[1];                        // ex: "PostRepository"
                const singularVar = varName.endsWith('s')
                    ? varName.slice(0, -1).toLowerCase()
                    : null;                                        // ex: "post"
                if (singularVar && objName.toLowerCase().startsWith(singularVar)) {
                    continue;
                }
            }

            // 4) Anterior: ignora plural/singular juntos no método
            const methodMatch = expression.match(/\.([A-Za-z0-9_]+)\(/);
            if (methodMatch) {
                const methodName = methodMatch[1];
                if (methodName.endsWith('s')) {
                    const singular = methodName.slice(0, -1);
                    if (expression.includes(`.${singular}(`)) {
                        continue;
                    }
                }
                // e também se GetEmail vs. toEmails
                const objectName = methodName.replace(/^get/i, '');
                if (objectName) {
                    const pluralObj = objectName.toLowerCase() + 's';
                    const varParts = varName
                        .split(/(?=[A-Z])|_/)
                        .map(p => p.toLowerCase())
                        .filter(Boolean);
                    if (varParts.includes(pluralObj)) {
                        continue;
                    }
                }
            }

            // 5) Verificação de relação original
            const varParts = varName
                .split(/(?=[A-Z])|_/)
                .map(p => p.toLowerCase())
                .filter(Boolean);

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
        const csPatterns = [
            /\b[\w<>\.]+\s*\[\]\s+(\w+)\b/g,
            /\b(?:List|IList|IEnumerable|Collection)<[^>]+>\s+(\w+)\b/g,
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
