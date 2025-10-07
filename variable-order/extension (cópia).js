// extension.js
const vscode = require('vscode');

let diagnosticCollection = null;

function activate(context) {
    diagnosticCollection = vscode.languages.createDiagnosticCollection('localVarOrder');
    context.subscriptions.push(diagnosticCollection);

    if (vscode.window.activeTextEditor) {
        analyzeDocument(vscode.window.activeTextEditor.document);
    }

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => analyzeDocument(doc)),
        vscode.workspace.onDidChangeTextDocument(evt => analyzeDocument(evt.document)),
        vscode.window.onDidChangeActiveTextEditor(editor => { if (editor) analyzeDocument(editor.document); })
    );
}

function deactivate() {
    diagnosticCollection?.dispose();
}

/* --------------------------------------
   Utilitários de parsing (braces, comentários)
   -------------------------------------- */

function findNextNonSpaceNonCommentChar(text, start) {
    const len = text.length;
    let i = start;
    while (i < len) {
        const ch = text[i];
        if (/\s/.test(ch)) { i++; continue; }

        // line comment //
        if (ch === '/' && text[i + 1] === '/') {
            i += 2;
            while (i < len && text[i] !== '\n') i++;
            continue;
        }
        // block comment /* */
        if (ch === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < len && !(text[i] === '*' && text[i + 1] === '/')) i++;
            i += 2;
            continue;
        }

        return { pos: i, ch };
    }
    return null;
}

function findMatchingBrace(text, openIndex) {
    const len = text.length;
    let depth = 0;
    for (let i = openIndex; i < len; i++) {
        const ch = text[i];

        // strings
        if (ch === '"' || ch === "'" || ch === '`') {
            const quote = ch;
            i++;
            while (i < len) {
                if (text[i] === '\\') { i += 2; continue; }
                if (text[i] === quote) break;
                i++;
            }
            continue;
        }

        // line comment
        if (ch === '/' && text[i + 1] === '/') {
            i += 2;
            while (i < len && text[i] !== '\n') i++;
            continue;
        }

        // block comment
        if (ch === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < len && !(text[i] === '*' && text[i + 1] === '/')) i++;
            i += 2;
            continue;
        }

        if (ch === '{') { depth++; continue; }
        if (ch === '}') { depth--; if (depth === 0) return i; continue; }
    }
    return -1;
}

/**
 * Preserva comprimento substituindo comentários/strings por espaços.
 * Mantém índices consistentes com o documento original.
 */
function stripCommentsAndStringsPreserve(code) {
    let s = code;
    s = s.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length)); // block
    s = s.replace(/\/\/.*$/mg, m => ' '.repeat(m.length)); // line
    s = s.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, m => ' '.repeat(m.length)); // strings
    return s;
}

function computeRelDepth(cleanBody, relIndex) {
    // conta '{' e '}' no trecho cleanBody[0 .. relIndex-1]
    let depth = 0;
    for (let i = 0; i < relIndex; i++) {
        const ch = cleanBody[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth = Math.max(0, depth - 1);
    }
    return depth;
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* --------------------------------------
   Dispatcher por linguagem
   -------------------------------------- */

function analyzeDocument(doc) {
    try {
        if (!doc || !diagnosticCollection) return;

        const text = doc.getText();
        const diagnostics = [];

        if (doc.languageId === 'csharp') {
            analyzeCSharpDocument(text, diagnostics, doc);
        } else if (['javascript', 'typescript', 'javascriptreact', 'typescriptreact'].includes(doc.languageId)) {
            analyzeJsTsDocument(text, diagnostics, doc);
        }

        diagnosticCollection.set(doc.uri, diagnostics);
    } catch (err) {
        console.error('localVarOrder analyzer error:', err);
    }
}

/* --------------------------------------
   Analisador C#
   -------------------------------------- */

function analyzeCSharpDocument(text, diagnostics, doc) {
    const methodSig = /(?:public|private|protected|internal|static|virtual|override|async|sealed|\s)+[\w<>\[\],\s]+\s+([A-Za-z_]\w*)\s*\([^)]*\)/g;
    let m;
    while ((m = methodSig.exec(text)) !== null) {
        const sigEnd = methodSig.lastIndex;
        const nxt = findNextNonSpaceNonCommentChar(text, sigEnd);
        if (!nxt || nxt.ch !== '{') continue;
        const openPos = nxt.pos;
        const closePos = findMatchingBrace(text, openPos);
        if (closePos === -1) continue;

        const bodyStart = openPos + 1;
        const bodyRaw = text.substring(bodyStart, closePos);
        analyzeSingleMethod(bodyRaw, bodyStart, diagnostics, doc);

        methodSig.lastIndex = closePos + 1;
    }
}

/* --------------------------------------
   Analisador JS/TS
   -------------------------------------- */

function analyzeJsTsDocument(text, diagnostics, doc) {
    const sigRegex = /(?:function\s+[A-Za-z_]\w*\s*\([^)]*\))|(?:[A-Za-z_]\w*\s*=\s*function\s*\([^)]*\))|(?:[A-Za-z_]\w*\s*\([^)]*\)\s*{)|(?:=\s*\([^)]*\)\s*=>)/g;
    let m;
    while ((m = sigRegex.exec(text)) !== null) {
        const sigEnd = sigRegex.lastIndex;
        const nxt = findNextNonSpaceNonCommentChar(text, sigEnd);
        if (!nxt || nxt.ch !== '{') continue;
        const openPos = nxt.pos;
        const closePos = findMatchingBrace(text, openPos);
        if (closePos === -1) continue;

        const bodyStart = openPos + 1;
        const bodyRaw = text.substring(bodyStart, closePos);
        analyzeSingleMethod(bodyRaw, bodyStart, diagnostics, doc);

        sigRegex.lastIndex = closePos + 1;
    }
}

/* --------------------------------------
   Núcleo: analisar UM método isoladamente
   - agora: variáveis são agrupadas por depth e NÃO vazam para scope externos
   - consumo (remoção) pode ocorrer por uso em qualquer depth
   - aviso só se a ocorrência estiver no mesmo depth da declaração anterior pendente
   -------------------------------------- */

function analyzeSingleMethod(bodyRaw, bodyAbsStart, diagnostics, doc) {
    const clean = stripCommentsAndStringsPreserve(bodyRaw);

    // Declarações locais (C#/JS comuns). Padrão captura tipo + nome ou var/let/const
    const declRegex = /\b(?:var|let|const|float|double|int|long|bool|byte|short|char|string|Vector[0-9]*|Rigidbody|Transform|GameObject|Quaternion)\s+([A-Za-z_]\w*)\b/g;
    const decls = []; // { name, declRelIndex, declAbsIndex, depth }
    let dm;
    while ((dm = declRegex.exec(clean)) !== null) {
        const name = dm[1];
        const rel = dm.index + dm[0].lastIndexOf(name); // posição RELATIVA ao bodyRaw do nome
        const abs = bodyAbsStart + rel;
        const depth = computeRelDepth(clean, rel);
        decls.push({ name, declRelIndex: rel, declAbsIndex: abs, depth });
    }

    if (decls.length < 1) return;

    // Agrupar declarações por depth, mantendo ordem de declaração e ignorando redeclarações posteriores
    const byDepth = new Map(); // depth -> array of {name, rel, abs}
    const firstSeen = new Set();
    for (const d of decls) {
        if (firstSeen.has(d.name)) continue; // ignora redeclarações posteriores
        firstSeen.add(d.name);
        if (!byDepth.has(d.depth)) byDepth.set(d.depth, []);
        byDepth.get(d.depth).push({ name: d.name, rel: d.declRelIndex, abs: d.declAbsIndex });
    }

    if ([...byDepth.values()].reduce((s, a) => s + a.length, 0) < 2) return;

    // Inicializa pendings por depth (cópia)
    const pendingByDepth = new Map();
    const nameToDeclDepth = new Map();
    for (const [depth, arr] of byDepth.entries()) {
        const names = arr.map(x => x.name);
        pendingByDepth.set(depth, names.slice());
        for (const n of names) nameToDeclDepth.set(n, depth);
    }

    // Percorre tokens do corpo (relativo) da esquerda para a direita
    const tokenRe = /\b[A-Za-z_]\w*\b/g;
    let tk;
    while ((tk = tokenRe.exec(clean)) !== null) {
        const token = tk[0];
        const relIndex = tk.index;
        const absIndex = bodyAbsStart + relIndex;

        // pular se é exatamente a posição da declaração do próprio token
        const isDeclHere = decls.some(d => d.declRelIndex === relIndex);
        if (isDeclHere) continue;

        // só nos interessam tokens que foram declarados em algum depth dentro deste método
        if (!nameToDeclDepth.has(token)) continue;
        const declDepth = nameToDeclDepth.get(token);

        // pendings da depth da declaração
        const pending = pendingByDepth.get(declDepth);
        if (!pending || pending.length === 0) continue;

        // índice na pending (se já removido, ignora)
        const pendingIndex = pending.indexOf(token);
        if (pendingIndex === -1) continue;

        // compute depth of this usage
        const tokenDepth = computeRelDepth(clean, relIndex);

        if (tokenDepth === declDepth) {
            // uso no mesmo nível da declaração
            if (pendingIndex === 0) {
                // uso correto — consome o primeiro
                pending.shift();
            } else {
                // uso errado no mesmo nível — gerar aviso sobre esta ocorrência
                const range = new vscode.Range(
                    doc.positionAt(absIndex),
                    doc.positionAt(absIndex + token.length)
                );
                diagnostics.push(new vscode.Diagnostic(
                    range,
                    `Variável "${token}" foi usada antes de "${pending[0]}" (declaração anterior no mesmo nível ainda não usada).`,
                    vscode.DiagnosticSeverity.Warning
                ));
                // remover esta variável da pending (após aviso)
                pending.splice(pendingIndex, 1);
            }
        } else {
            // uso em depth diferente (ex.: variável do nível superior sendo usada dentro de bloco interno)
            // não emitir aviso, mas considerar como "uso" e remover da pending correspondente
            pending.splice(pendingIndex, 1);
        }

        // atualiza pendings no map (se esvaziou, manter array vazia)
        pendingByDepth.set(declDepth, pending);
    }
}

module.exports = {
    activate,
    deactivate
};
