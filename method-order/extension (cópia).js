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
        methods.push({ name, start: match.index });
    }
    const definedOrder = methods.map(m => m.name);

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
        let cm;
        while ((cm = callRegex.exec(body)) !== null) {
            const callee = cm[1];
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
    let lastLineWasEmpty = false;

    for (let i = 0; i < methods.length; i++) {
        const m = methods[i];
        const lineNumber = text.substring(0, m.start).split('\n').length - 1;

        // Verifica se há linhas em branco antes do método
        let hasEmptyLineBefore = false;
        for (let l = lineNumber - 1; l >= 0; l--) {
            const line = lines[l].trim();
            if (line === '') {
                hasEmptyLineBefore = true;
                continue;
            }
            if (line.startsWith('//')) {
                currentBlock = line.replace('//', '').trim();
                break;
            } else {
                // Se encontrou linha não vazia e não é comentário, mantém o bloco atual
                if (hasEmptyLineBefore) {
                    currentBlock = `__GROUP_${l}__`; // Cria um bloco único baseado na linha
                }
                break;
            }
        }

        if (!blocks[currentBlock]) blocks[currentBlock] = [];
        blocks[currentBlock].push(methods[i]);
        blockMap[m.name] = currentBlock;
    }

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
                const cm = methods.find(x => x.name === expected);
                const pos = document.positionAt(cm.start);
                const range = new vscode.Range(pos, pos.translate(0, expected.length));

                diagnostics.push(new vscode.Diagnostic(
                    range,
                    `O método "${expected}" precisa estar abaixo de "${caller}" como chamada ${k + 1}.`,
                    vscode.DiagnosticSeverity.Warning
                ));
                warned.add(callee);
            }
        }
    }

    for (const blockName of Object.keys(blocks)) {
        const blockMethods = blocks[blockName];
        const allCalled = new Set([].concat(...callMap.values()));
        const uncalled = blockMethods.filter(x => !allCalled.has(x.name)).sort((a, b) => a.start - b.start);
        const anyIdx = prefixOrders.indexOf('__ANY__');

        const withIdx = uncalled.map(x => {
            let p = prefixOrders.findIndex(pref => x.name.startsWith(pref));
            if (p === -1) p = anyIdx;
            return { ...x, prefixIdx: p, suffix: x.name.toLowerCase() };
        });

        for (let i = 0; i < withIdx.length - 1; i++) {
            const cur = withIdx[i], nxt = withIdx[i + 1];
            if (cur.prefixIdx > nxt.prefixIdx ||
                (cur.prefixIdx === nxt.prefixIdx && cur.suffix > nxt.suffix)) {
                const pos = document.positionAt(nxt.start);
                const rng = new vscode.Range(pos, pos.translate(0, nxt.name.length));

                diagnostics.push(new vscode.Diagnostic(
                    rng,
                    `O método "${nxt.name}" precisa estar acima de "${cur.name}" dentro do bloco "${blockName}".`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
        }
    }

    diagnosticsCollection.set(document.uri, diagnostics);
}

module.exports = { activate, deactivate };

