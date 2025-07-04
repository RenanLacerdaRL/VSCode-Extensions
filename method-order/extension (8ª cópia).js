const vscode = require('vscode');

let diagnosticsCollection;

function activate(context) {
    diagnosticsCollection = vscode.languages.createDiagnosticCollection('rl.method-order');

    if (vscode.window.activeTextEditor) {
        analyzeDocument(vscode.window.activeTextEditor.document);
    }

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => editor && analyzeDocument(editor.document)),
        vscode.workspace.onDidChangeTextDocument(e => analyzeDocument(e.document)),
        diagnosticsCollection
    );
}

function deactivate() {
    diagnosticsCollection && diagnosticsCollection.dispose();
}

function analyzeDocument(document) {
    const langs = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'csharp'];
    if (!langs.includes(document.languageId)) {
        diagnosticsCollection.delete(document.uri);
        return;
    }

    const controlKeywords = ['if', 'for', 'foreach', 'forof', 'for of', 'while', 'switch', 'catch', 'else', 'do', 'try'];
    const config = vscode.workspace.getConfiguration('rl.method-order');
    const prefixOrders = config.get('prefixOrder') || [];
    const enforceCallOrder = config.get('enforceCallOrder') === true;
    const enforceAlphabeticalOrder = config.get('enforceAlphabeticalOrder') === true;
    const text = document.getText();
    const diagnostics = [];

    // Captura posições de comentários para reset de blocos
    const commentPositions = [];
    const commentRegex = /\/\/.*$/gm;
    let cMatch;
    while ((cMatch = commentRegex.exec(text)) !== null) {
        commentPositions.push(cMatch.index);
    }

    // Captura todas as declarações de métodos
    const methodRegex = /\b(\w+)\s*\([^)]*\)\s*\{/g;
    const methods = [];
    let mMatch;
    while ((mMatch = methodRegex.exec(text)) !== null) {
        const name = mMatch[1];
        if (controlKeywords.includes(name)) continue;
        methods.push({ name, start: mMatch.index });
    }

    // Build call map if enforceCallOrder
    let callMap = new Map();
    let firstCaller = {};
    if (enforceCallOrder) {
        for (let i = 0; i < methods.length; i++) {
            const m = methods[i];
            const bodyStart = text.indexOf('{', m.start);
            let braceCount = 1, j = bodyStart + 1;
            while (j < text.length && braceCount > 0) {
                if (text[j] === '{') braceCount++;
                else if (text[j] === '}') braceCount--;
                j++;
            }
            let body = text.slice(bodyStart + 1, j - 1);
            body = body.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
            const calls = [];
            const callRegex = /(?:this\.|(?<![\.\w]))(\w+)\s*\(/g;
            let cm;
            while ((cm = callRegex.exec(body)) !== null) {
                const callee = cm[1];
                if (methods.some(x => x.name === callee) && callee !== m.name) {
                    if (!calls.includes(callee)) {
                        calls.push(callee);
                        if (firstCaller[callee] === undefined) {
                            firstCaller[callee] = i;
                        }
                    }
                }
            }
            callMap.set(m.name, calls);
        }
    }

    // Verifica existência de prefixo
    methods.forEach(m => {
        const hasPrefix = prefixOrders.some(pref => m.name.startsWith(pref));
        if (!hasPrefix) {
            const pos = document.positionAt(m.start);
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(pos, pos.translate(0, m.name.length)),
                `Prefixo desconhecido para o método "${m.name}".`,
                vscode.DiagnosticSeverity.Warning
            ));
        }
    });

    // Verifica ordem: call order tem prioridade sobre prefixOrder
    let lastIdx = -1;
    let lastMethod = null;
    let commentIdx = 0;
    let lastPrefix = null;

    methods.forEach(m => {
        // reset de bloco por comentário
        while (commentIdx < commentPositions.length && commentPositions[commentIdx] < m.start) {
            lastIdx = -1;
            lastMethod = null;
            lastPrefix = null;
            commentIdx++;
        }

        // Se enforceCallOrder e método tem chamador, faz só call order
        if (enforceCallOrder && firstCaller[m.name] !== undefined) {
            const callerIdx = firstCaller[m.name];
            const callerMethod = methods[callerIdx];
            const mIdx = methods.indexOf(m);
            if (mIdx <= callerIdx) {
                const pos = document.positionAt(m.start);
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(pos, pos.translate(0, m.name.length)),
                    `O método "${m.name}" precisa estar abaixo de "${callerMethod.name}".`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
            return;
        }

        // Verifica prefixOrder + ordem alfabética
        const idx = prefixOrders.findIndex(pref => m.name.startsWith(pref));
        if (idx >= 0) {
            if (lastMethod && idx < lastIdx) {
                const pos = document.positionAt(m.start);
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(pos, pos.translate(0, m.name.length)),
                    `O método "${m.name}" precisa estar acima de "${lastMethod.name}".`,
                    vscode.DiagnosticSeverity.Warning
                ));
            } else if (enforceAlphabeticalOrder && lastIdx === idx && lastPrefix === prefixOrders[idx]) {
                if (m.name.localeCompare(lastMethod.name) < 0) {
                    const pos = document.positionAt(m.start);
                    diagnostics.push(new vscode.Diagnostic(
                        new vscode.Range(pos, pos.translate(0, m.name.length)),
                        `O método "${m.name}" está fora de ordem alfabética dentro do prefixo "${prefixOrders[idx]}".`,
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
            }
            lastIdx = idx;
            lastMethod = m;
            lastPrefix = prefixOrders[idx];
        }
    });

    diagnosticsCollection.set(document.uri, diagnostics);
}

module.exports = { activate, deactivate };
