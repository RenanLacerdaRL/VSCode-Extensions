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

/* -------------------------
   Utilitários
   ------------------------- */

// preserva comprimento: substitui comentários/strings por espaços
function stripCommentsAndStringsPreserve(code) {
    let s = code;
    s = s.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length)); // block
    s = s.replace(/\/\/.*$/mg, m => ' '.repeat(m.length)); // line
    s = s.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, m => ' '.repeat(m.length)); // strings
    return s;
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// encontra '}' correspondente à '{' em openIndex (usa texto original e ignora strings/comentários)
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

        if (ch === '{') { depth++; continue; }
        if (ch === '}') { depth--; if (depth === 0) return i; continue; }
    }
    return -1;
}

// encontra parêntese correspondente para ')' em pos (varre para trás)
function findMatchingParenBackward(clean, closePos) {
    let depth = 0;
    for (let i = closePos; i >= 0; i--) {
        const ch = clean[i];
        if (ch === ')') depth++;
        else if (ch === '(') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

// encontra parêntese correspondente para ')' em pos (varre para frente)
function findMatchingParenForward(clean, openPos) {
    let depth = 0;
    const len = clean.length;
    for (let i = openPos; i < len; i++) {
        const ch = clean[i];
        if (ch === '(') depth++;
        else if (ch === ')') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

// retorna índice do caractere não-space mais próximo para trás (cleaned)
function findPrevNonSpaceIndex(clean, pos) {
    for (let i = pos; i >= 0; i--) {
        if (!/\s/.test(clean[i])) return i;
    }
    return -1;
}

function computeRelDepth(cleanBody, relIndex) {
    let depth = 0;
    for (let i = 0; i < relIndex; i++) {
        const ch = cleanBody[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth = Math.max(0, depth - 1);
    }
    return depth;
}

/* -------------------------
   Dispatcher
   ------------------------- */

function analyzeDocument(doc) {
    try {
        if (!doc || !diagnosticCollection) return;

        const text = doc.getText();
        const diagnostics = [];

        // vamos usar a mesma estratégia para C# e JS/TS: procurar por '{' que seguem ')'
        // e ignorar palavras-chave de controle (if/for/while/foreach/switch/catch/using/lock/else)
        const controlKeywords = new Set(['if', 'for', 'while', 'foreach', 'switch', 'catch', 'using', 'lock', 'else', 'do', 'try']);

        // cria versão limpa (sem comentários/strings) para navegação segura
        const clean = stripCommentsAndStringsPreserve(text);
        const len = clean.length;

        for (let i = 0; i < len; i++) {
            if (clean[i] !== '{') continue;
            // encontramos um '{' — verificar se é o bloco de um método/função (ou bloco de controle)
            // procurar o caractere não-space anterior
            const prevIdx = findPrevNonSpaceIndex(clean, i - 1);
            if (prevIdx === -1) continue;

            // se o prev char não for ')', provavelmente não é uma assinatura (pode ser "{" de bloco sem par)
            if (clean[prevIdx] !== ')') continue;

            // achar '(' correspondente recuando
            const openParen = findMatchingParenBackward(clean, prevIdx);
            if (openParen === -1) continue;

            // pegar token anterior ao '(' para checar se é uma palavra-chave de controle
            const beforeOpen = findPrevNonSpaceIndex(clean, openParen - 1);
            if (beforeOpen === -1) continue;

            // extrair palavra (alfanum/_)
            let startWord = beforeOpen;
            while (startWord >= 0 && /[A-Za-z0-9_]/.test(clean[startWord])) startWord--;
            const word = clean.substring(startWord + 1, beforeOpen + 1);
            // se for palavra de controle, ignorar (não é método)
            if (controlKeywords.has(word)) continue;

            // caso contrário, acreditamos ser assinatura de método/função — pegar body usando findMatchingBrace no texto original
            const openPos = i;
            const closePos = findMatchingBrace(text, openPos);
            if (closePos === -1) continue;

            const bodyStart = openPos + 1;
            const bodyRaw = text.substring(bodyStart, closePos);

            // analisar apenas o corpo do método (isolado)
            analyzeSingleMethod(bodyRaw, bodyStart, diagnostics, doc);

            // pular para after closePos para evitar reprocessar braces dentro do método
            i = closePos + 1;
        }

        diagnosticCollection.set(doc.uri, diagnostics);
    } catch (err) {
        console.error('localVarOrder analyzer error:', err);
    }
}

/* -------------------------
   Núcleo: analisar UM método isoladamente
   - mesma lógica que combinamos: agrupamento por depth, pending por depth,
     uso em qualquer depth consome, aviso só se ocorrência estiver no mesmo depth
     da declaração anterior.
   - MODIFICAÇÃO: agora IGNORA declarações se **na mesma linha** existir 'for'.
   ------------------------- */

function analyzeSingleMethod(bodyRaw, bodyAbsStart, diagnostics, doc) {
    const clean = stripCommentsAndStringsPreserve(bodyRaw);

    // detectar ranges de cabeçalhos 'for(...)' no corpo (relativos a bodyRaw/clean) — mantido para possível uso futuro
    const forRanges = [];
    const forRegex = /\bfor\s*\(/g;
    let fm;
    while ((fm = forRegex.exec(clean)) !== null) {
        const forPos = fm.index;
        // localizar o parêntese '(' após 'for'
        const openParen = clean.indexOf('(', forPos);
        if (openParen === -1) continue;
        const closeParen = findMatchingParenForward(clean, openParen);
        if (closeParen === -1) continue;
        // armazenar intervalo [openParen, closeParen] (relativo a clean/bodyRaw)
        forRanges.push([openParen, closeParen]);
        // avançar regex para depois do closeParen
        forRegex.lastIndex = closeParen + 1;
    }

    function isInForHeader(relIndex) {
        for (const r of forRanges) {
            if (relIndex >= r[0] && relIndex <= r[1]) return true;
        }
        return false;
    }

    // Nova função: verifica se na MESMA LINHA do índice relativo existe a palavra 'for'
    function isForOnSameLine(relIndex) {
        // encontra início da linha (último '\n' antes de relIndex)
        const lineStart = clean.lastIndexOf('\n', relIndex - 1);
        const lineEnd = clean.indexOf('\n', relIndex);
        const start = lineStart === -1 ? 0 : lineStart + 1;
        const end = lineEnd === -1 ? clean.length : lineEnd;
        const line = clean.substring(start, end);
        return /\bfor\b/.test(line);
    }

    const declRegex = /\b(?:var|let|const|float|double|int|long|bool|byte|short|char|string|Vector[0-9]*|Rigidbody|Transform|GameObject|Quaternion)\s+([A-Za-z_]\w*)\b/g;
    const decls = [];
    let dm;
    while ((dm = declRegex.exec(clean)) !== null) {
        const name = dm[1];
        const rel = dm.index + dm[0].lastIndexOf(name);

        // **ALTERAÇÃO AQUI**: se na mesma linha existir 'for', IGNORA a declaração (pedido do usuário)
        if (isForOnSameLine(rel)) continue;

        // (não removemos outros comportamentos — se precisar podemos combinar isInForHeader também)
        const abs = bodyAbsStart + rel;
        const depth = computeRelDepth(clean, rel);
        decls.push({ name, declRelIndex: rel, declAbsIndex: abs, depth });
    }

    if (decls.length < 1) return;

    // agrupar por depth e manter primeira declaração de cada nome
    const byDepth = new Map();
    const firstSeen = new Set();
    for (const d of decls) {
        if (firstSeen.has(d.name)) continue;
        firstSeen.add(d.name);
        if (!byDepth.has(d.depth)) byDepth.set(d.depth, []);
        byDepth.get(d.depth).push({ name: d.name, rel: d.declRelIndex, abs: d.declAbsIndex });
    }

    if ([...byDepth.values()].reduce((s, a) => s + a.length, 0) < 2) return;

    const pendingByDepth = new Map();
    const nameToDeclDepth = new Map();
    for (const [depth, arr] of byDepth.entries()) {
        const names = arr.map(x => x.name);
        pendingByDepth.set(depth, names.slice());
        for (const n of names) nameToDeclDepth.set(n, depth);
    }

    // percorre tokens do corpo limpo (relativo)
    const tokenRe = /\b[A-Za-z_]\w*\b/g;
    let tk;
    while ((tk = tokenRe.exec(clean)) !== null) {
        const token = tk[0];
        const relIndex = tk.index;
        const absIndex = bodyAbsStart + relIndex;

        // pular quando token é exatamente declaração do nome
        const isDeclHere = decls.some(d => d.declRelIndex === relIndex);
        if (isDeclHere) continue;

        if (!nameToDeclDepth.has(token)) continue;
        const declDepth = nameToDeclDepth.get(token);
        const pending = pendingByDepth.get(declDepth);
        if (!pending || pending.length === 0) continue;

        // índice na pending
        const pendingIndex = pending.indexOf(token);
        if (pendingIndex === -1) continue;

        // profundidade do uso
        const tokenDepth = computeRelDepth(clean, relIndex);

        if (tokenDepth === declDepth) {
            // uso no mesmo nível
            if (pendingIndex === 0) {
                // consumo correto
                pending.shift();
            } else {
                // fora de ordem no mesmo nível -> avisar
                const range = new vscode.Range(
                    doc.positionAt(absIndex),
                    doc.positionAt(absIndex + token.length)
                );
                diagnostics.push(new vscode.Diagnostic(
                    range,
                    `Variável "${token}" foi usada antes de "${pending[0]}" (declaração anterior no mesmo nível ainda não usada).`,
                    vscode.DiagnosticSeverity.Warning
                ));
                // remover token da pending após aviso
                pending.splice(pendingIndex, 1);
            }
        } else {
            // uso em outro depth: não avisa, mas consome a variável (remove da pending da sua depth)
            pending.splice(pendingIndex, 1);
        }

        pendingByDepth.set(declDepth, pending);
    }
}

module.exports = {
    activate,
    deactivate
};
