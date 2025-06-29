const vscode = require('vscode');

let diagnosticsCollection;

const controlKeywords = ['if', 'for', 'while', 'switch', 'catch', 'else', 'do', 'try'];
const controlKeywordsPattern = controlKeywords.join('|');

function activate(context) {
    diagnosticsCollection = vscode.languages.createDiagnosticCollection('methodOrder');

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
    const tsLangs = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'];
    const isTS = tsLangs.includes(document.languageId);
    const isCS = document.languageId === 'csharp';

    if (!isTS && !isCS) {
        diagnosticsCollection.delete(document.uri);
        return;
    }

    const config = vscode.workspace.getConfiguration('methodOrder');
    const prefixOrders = config.get('prefixOrder') || [];
    const enforceCallOrder = config.get('enforceCallOrder') !== false;
    const alphabeticalSuffixes = config.get('alphabeticalSuffixes') || [];

    const text = document.getText();
    const diagnostics = [];

    const csMethodRegex = /((public|protected|internal|private)\s+)?(static\s+)?(?:void|\w+)\s+(\w+)\s*\([^)]*\)\s*\{/g;
    const tsMethodRegex = new RegExp(
        `^\\s*(?:public|protected|private)?\\s*(?:static\\s+)?(?:async\\s+)?(?!(${controlKeywordsPattern})\\b)(\\w+)\\s*\\([^)]*\\)\\s*(?::\\s*[\\w<>\\[\\]\\|\\s,]*)?\\s*\\{`,
        'gm'
    );

    const methods = [];
    let match;
    const defRegex = isCS ? csMethodRegex : tsMethodRegex;
    while ((match = defRegex.exec(text)) !== null) {
        const name = isCS ? match[4] : match[2];
        if (controlKeywords.includes(name)) continue;
        methods.push({ name, start: match.index });
    }

    let className = '';
    const classMatch = text.match(/class\s+(\w+)/);
    if (classMatch) className = classMatch[1];

    const classNameEndsWithAlphabeticalSuffix = alphabeticalSuffixes.some(suffix =>
        className.endsWith(suffix)
    );

    const definedOrder = methods.map(m => m.name);
    if (className && definedOrder.includes(className)) {
        const constructorIndex = definedOrder.indexOf(className);
        if (constructorIndex > 0) {
            const cm = methods.find(x => x.name === className);
            const pos = document.positionAt(cm.start);
            const range = new vscode.Range(pos, pos.translate(0, className.length));
            diagnostics.push(new vscode.Diagnostic(
                range,
                `O construtor "${className}" deve ser o primeiro método da classe.`,
                vscode.DiagnosticSeverity.Warning
            ));
        }
    }

    const callMap = new Map();
    const firstCaller = {};

    for (let i = 0; i < methods.length; i++) {
        const m = methods[i];
        const bodyStart = text.indexOf('{', m.start);
        let braceCount = 1, j = bodyStart + 1;
        while (j < text.length && braceCount > 0) {
            if (text[j] === '{') braceCount++;
            else if (text[j] === '}') braceCount--;
            j++;
        }
        const body = text.slice(bodyStart + 1, j - 1);

        const calls = [];
        const callRegex = /(?:this\.|(?<![\.\w]))(\w+)\s*\(/g;
        let cm2;
        while ((cm2 = callRegex.exec(body)) !== null) {
            const callee = cm2[1];
            if (definedOrder.includes(callee) && callee !== m.name) {
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

    const blocks = {};
    const lines = text.split('\n');
    let currentBlock = '__DEFAULT__';
    let blockMap = {};

    for (let i = 0; i < methods.length; i++) {
        const m = methods[i];
        const lineNumber = text.substring(0, m.start).split('\n').length - 1;
        let hasEmptyLineBefore = false;
        for (let l = lineNumber - 1; l >= 0; l--) {
            const line = lines[l].trim();
            if (line === '') { hasEmptyLineBefore = true; continue; }
            if (line.startsWith('//')) {
                currentBlock = line.replace('//', '').trim();
                break;
            } else {
                if (hasEmptyLineBefore) {
                    currentBlock = `__GROUP_${l}__`;
                }
                break;
            }
        }
        if (!blocks[currentBlock]) blocks[currentBlock] = [];
        blocks[currentBlock].push(m);
        blockMap[m.name] = currentBlock;
    }

    if (enforceCallOrder && !classNameEndsWithAlphabeticalSuffix) {
        const warned = new Set();
        for (const [caller, calls] of callMap.entries()) {
            if (!calls.length) continue;
            const callerIdx = definedOrder.indexOf(caller);
            for (let k = 0; k < calls.length; k++) {
                const callee = calls[k];
                if (firstCaller[callee] !== callerIdx) continue;
                if (warned.has(callee)) continue;
                const expected = callee;
                const actual = definedOrder[callerIdx + 1 + k];
                if (actual !== expected) {
                    const cm3 = methods.find(x => x.name === expected);
                    const pos = document.positionAt(cm3.start);
                    const range = new vscode.Range(pos, pos.translate(0, expected.length));
                    diagnostics.push(new vscode.Diagnostic(
                        range,
                        `O método "${expected}" precisa estar abaixo de "${caller}".`,
                        vscode.DiagnosticSeverity.Warning
                    ));
                    warned.add(callee);
                }
            }
        }
    }

    for (const blockName of Object.keys(blocks)) {
        const blockMethods = blocks[blockName];
        const allCalled = new Set([].concat(...callMap.values()));
        const uncalled = blockMethods.filter(x => !allCalled.has(x.name)).sort((a, b) => a.start - b.start);
        const anyIdx = prefixOrders.indexOf('__ANY__');

        const withIdx = uncalled.map(x => {
            if (isCS && x.name === className) return { ...x, prefixIdx: -1, suffix: x.name.toLowerCase() };
            let p = prefixOrders.findIndex(pref => x.name.startsWith(pref));
            if (p === -1) p = anyIdx;
            return { ...x, prefixIdx: p, suffix: x.name.toLowerCase() };
        });

        // Enforce ordering
        for (let i = 0; i < withIdx.length - 1; i++) {
            const cur = withIdx[i], nxt = withIdx[i + 1];
            if (isCS && (cur.name === className || nxt.name === className)) continue;
            if (classNameEndsWithAlphabeticalSuffix) {
                // Alphabetical enforcement
                if (cur.suffix > nxt.suffix) {
                    const pos = document.positionAt(nxt.start);
                    const rng = new vscode.Range(pos, pos.translate(0, nxt.name.length));
                    diagnostics.push(new vscode.Diagnostic(
                        rng,
                        `O método "${nxt.name}" precisa estar acima de "${cur.name}" (ordem alfabética).`,
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
            } else {
                // Prefix-based enforcement
                if (cur.prefixIdx > nxt.prefixIdx ||
                    (cur.prefixIdx === nxt.prefixIdx && cur.suffix > nxt.suffix)) {
                    const pos = document.positionAt(nxt.start);
                    const rng = new vscode.Range(pos, pos.translate(0, nxt.name.length));
                    diagnostics.push(new vscode.Diagnostic(
                        rng,
                        `O método "${nxt.name}" precisa estar acima de "${cur.name}".`,
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
            }
        }

        // Novo: marcar prefixos desconhecidos apenas para prefix-based
        if (!classNameEndsWithAlphabeticalSuffix) {
            for (const m of withIdx) {
                if (m.prefixIdx === -1 && !isCS) {
                    const pos = document.positionAt(m.start);
                    const range = new vscode.Range(pos, pos.translate(0, m.name.length));
                    diagnostics.push(new vscode.Diagnostic(
                        range,
                        `Prefixo desconhecido para o método "${m.name}".`,
                        vscode.DiagnosticSeverity.Information
                    ));
                }
            }
        }
    }

    diagnosticsCollection.set(document.uri, diagnostics);
}

module.exports = { activate, deactivate };
