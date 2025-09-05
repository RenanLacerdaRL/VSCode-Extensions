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

    // Avoid matching URLs by only catching // not preceded by ':'
    const commentRegex = /(?<!:)\/\/.*$/gm;
    const commentPositions = [];
    let cMatch;
    const text = document.getText();
    while ((cMatch = commentRegex.exec(text)) !== null) {
        commentPositions.push(cMatch.index);
    }

    const controlKeywords = ['if', 'for', 'foreach', 'forof', 'for of', 'while', 'switch', 'catch', 'else', 'do', 'try'];
    const config = vscode.workspace.getConfiguration('rl.method-order');
    const prefixOrders = config.get('prefixOrder') || [];
    const enforceCallOrder = config.get('enforceCallOrder') === true;
    const enforceAlphabeticalOrder = config.get('enforceAlphabeticalOrder') === true;
    const alphabeticalOnlyPrefixes = config.get('alphabeticalOnlyPrefixes') || [];
    const ignoreMethods = config.get('ignoreMethods') || [];

    const classRegex = /(?:export\s+)?class\s+(\w+)/;
    const classMatch = classRegex.exec(text);
    const className = classMatch ? classMatch[1] : '';
    const ignoreUnknownPrefixes = alphabeticalOnlyPrefixes.some(suffix => className.endsWith(suffix));

//     const methodRegex = /^\s*(?:public|protected|private|internal)?\s*(?:static\s*)?(?:async\s*)?(?:[\w<>\[\],\s]+\s+)?(\w+)\s*\([^)]*\)\s*\{/gm;
    const methodRegex = /^\s*(?:public|protected|private|internal)?\s*(?:static\s*)?(?:async\s*)?(?:[\w<>\[\],\s]+\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[\w<>\[\],\s]+)?\s*\{/gm;

    const methods = [];
    let mMatch;
    while ((mMatch = methodRegex.exec(text)) !== null) {
        const name = mMatch[1];
        if (controlKeywords.includes(name)) continue;
        if (ignoreMethods.includes(name)) continue;
        const methodStart = mMatch.index;
        const nameStart = methodStart + mMatch[0].indexOf(name);
        methods.push({ name, start: methodStart, nameStart });
    }

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
            // Avoid stripping URLs as comments
            body = body.replace(/(?<!:)\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
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

    const diagnostics = [];
    if (!ignoreUnknownPrefixes) {
        methods.forEach(m => {
            const hasPrefix = prefixOrders.some(pref => m.name.startsWith(pref));
            if (!hasPrefix) {
                const pos = document.positionAt(m.nameStart);
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(pos, pos.translate(0, m.name.length)),
                    `Prefixo desconhecido para o método "${m.name}".`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
        });
    }

    // Special case: for classes ending with configured suffix and alphabetical order enabled
    if (ignoreUnknownPrefixes && enforceAlphabeticalOrder) {
    let lastPrefix = null;
    let lastMethodName = null;

    methods.forEach((m, idx) => {
        // 🚨 Sempre ignore o constructor na ordenação
        if (m.name === 'constructor') {
            if (idx > 0) {
                const pos = document.positionAt(m.nameStart);
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(pos, pos.translate(0, m.name.length)),
                    `O "constructor" deve vir antes de todos os outros métodos.`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
            return; // não atualiza lastPrefix / lastMethodName
        }

        // Extrai prefixo (primeiro segmento PascalCase)
        const prefixMatch = /^([A-Z][a-z]+)/.exec(m.name);
        const prefix = prefixMatch ? prefixMatch[1] : m.name;

        if (lastPrefix) {
            if (prefix.localeCompare(lastPrefix) < 0) {
                const pos = document.positionAt(m.nameStart);
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(pos, pos.translate(0, m.name.length)),
                    `O grupo de prefixos "${prefix}" deve vir antes de "${lastPrefix}".`,
                    vscode.DiagnosticSeverity.Warning
                ));
            } else if (prefix === lastPrefix && m.name.localeCompare(lastMethodName) < 0) {
                const pos = document.positionAt(m.nameStart);
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(pos, pos.translate(0, m.name.length)),
                    `O método "${m.name}" está fora de ordem alfabética dentro do prefixo "${prefix}".`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
        }

        lastPrefix = prefix;
        lastMethodName = m.name;
    });

    diagnosticsCollection.set(document.uri, diagnostics);
    return;
}

    // ... existing logic for call order and prefixOrder/enforceAlphabeticalOrder ...
    let lastIdx = -1;
    let lastMethod = null;
    let commentIdx = 0;
    let lastPref = null;

    methods.forEach(m => {
        while (commentIdx < commentPositions.length && commentPositions[commentIdx] < m.start) {
            lastIdx = -1;
            lastMethod = null;
            lastPref = null;
            commentIdx++;
        }

        if (enforceCallOrder && firstCaller[m.name] !== undefined) {
            const callerIdx = firstCaller[m.name];
            const callerMethod = methods[callerIdx];
            const mIdx = methods.indexOf(m);
            if (mIdx <= callerIdx) {
                const pos = document.positionAt(m.nameStart);
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(pos, pos.translate(0, m.name.length)),
                    `O método "${m.name}" precisa estar abaixo de "${callerMethod.name}".`,
                    vscode.DiagnosticSeverity.Hint
                ));
            }
            return;
        }

        const idx = prefixOrders.findIndex(pref => m.name.startsWith(pref));
        if (idx >= 0) {
            if (lastMethod && idx < lastIdx) {
                const pos = document.positionAt(m.nameStart);
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(pos, pos.translate(0, m.name.length)),
                    `O método "${m.name}" precisa estar acima de "${lastMethod.name}".`,
                    vscode.DiagnosticSeverity.Hint
                ));
            } else if (enforceAlphabeticalOrder && lastIdx === idx && lastPref === prefixOrders[idx]) {
                if (m.name.localeCompare(lastMethod.name) < 0) {
                    const pos = document.positionAt(m.nameStart);
                    diagnostics.push(new vscode.Diagnostic(
                        new vscode.Range(pos, pos.translate(0, m.name.length)),
                        `O método "${m.name}" está fora de ordem alfabética dentro do prefixo "${prefixOrders[idx]}".`,
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
            }
            lastIdx = idx;
            lastMethod = m;
            lastPref = prefixOrders[idx];
        }
    });

    diagnosticsCollection.set(document.uri, diagnostics);
}

module.exports = { activate, deactivate };
