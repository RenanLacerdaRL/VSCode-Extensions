const vscode = require('vscode');

let diagnosticsCollection;

function activate(context) {
    diagnosticsCollection = vscode.languages.createDiagnosticCollection('orderChecker');
    context.subscriptions.push(diagnosticsCollection);

    vscode.workspace.onDidOpenTextDocument(checkDocument, null, context.subscriptions);
    vscode.workspace.onDidChangeTextDocument(e => checkDocument(e.document), null, context.subscriptions);

    if (vscode.window.activeTextEditor) {
        checkDocument(vscode.window.activeTextEditor.document);
    }
}

function deactivate() {
    diagnosticsCollection?.dispose();
}

function checkDocument(doc) {
    const lang = doc.languageId;
    if (!['typescript','javascript','typescriptreact','javascriptreact','csharp'].includes(lang)) return;

    const text = doc.getText();
    const diagnostics = [];

    if (lang === 'csharp') {
        analyzeCSharp(text, diagnostics, doc);
    } else {
        analyzeJsTs(text, diagnostics, doc);
    }

    diagnosticsCollection.set(doc.uri, diagnostics);
}

// ---------- JS/TS ----------
function analyzeJsTs(text, diagnostics, doc) {
    const patterns = [
        /(?:async\s+)?function\s+\w*\s*\(([^)]*)\)\s*\{([\s\S]*?)\}/g,            // function foo(...)
        /(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*\{([\s\S]*?)\}/g                     // class Foo { bar(...) { ... } }
    ];

    for (const re of patterns) {
        let m;
        while ((m = re.exec(text)) !== null) {
            const paramsRaw = (re === patterns[0]) ? m[1] : m[2];
            const bodyRaw   = (re === patterns[0]) ? m[2] : m[3];
            const bodyOffset = m.index + m[0].lastIndexOf('{') + 1;

            const params = cleanParams(paramsRaw);
            // parametros: checa ordem (não precisa ignorar declarações porque params não estão no body)
            if (params.length > 1) checkOrder(params, bodyRaw, bodyOffset, diagnostics, doc, 'Parâmetro', []);

            // variáveis locais: captura declarações e suas posições EXATAS do nome
            const decls = findVarDecls(bodyRaw, bodyOffset, /\b(const|let|var)\s+([a-zA-Z_$][\w$]*)/g);
            if (decls.length > 1) {
                const names = decls.map(x => x.name);
                // passamos a lista de posições de declaração para serem ignoradas na busca de ocorrências
                const declPositions = decls.map(d => ({ name: d.name, pos: d.pos, len: d.name.length }));
                checkOrder(names, bodyRaw, bodyOffset, diagnostics, doc, 'Variável', declPositions);
            }
        }
    }
}

// ---------- C# ----------
function analyzeCSharp(text, diagnostics, doc) {
    // métodos: (modifiers)? returnType Name(type p1, type p2) { ... }
    const methodRe = /\b(?:public|private|protected|internal)?\s*(?:static\s+)?(?:async\s+)?[\w<>,\s\?\[\]]+\s+(\w+)\s*\(([^)]*)\)\s*\{([\s\S]*?)\}/g;

    let m;
    while ((m = methodRe.exec(text)) !== null) {
        const paramsRaw = m[2];
        const bodyRaw   = m[3];
        const bodyOffset = m.index + m[0].lastIndexOf('{') + 1;

        const params = paramsRaw
            .split(',')
            .map(p => p.trim().split(' ').pop()) // pega o nome (último token)
            .filter(Boolean);
        if (params.length > 1) checkOrder(params, bodyRaw, bodyOffset, diagnostics, doc, 'Parâmetro', []);

        // variáveis locais: detecta declarações do tipo "var x = ..." ou "int x = ..." etc
        const decls = findVarDecls(
            bodyRaw,
            bodyOffset,
            /\b(?:var|int|float|double|string|bool|decimal|object|dynamic|long|short|byte|char)\s+([a-zA-Z_]\w*)\s*=/g
        );
        if (decls.length > 1) {
            const names = decls.map(x => x.name);
            const declPositions = decls.map(d => ({ name: d.name, pos: d.pos, len: d.name.length }));
            checkOrder(names, bodyRaw, bodyOffset, diagnostics, doc, 'Variável', declPositions);
        }
    }
}

// ---------- UTILS ----------

function cleanParams(raw) {
    return raw
        .split(',')
        .map(p => p.trim().split(':')[0].split('=')[0].trim())
        .map(p => p.replace(/^[\[\{].*[\}\]]$/,'').trim()) // remove destruturing feio
        .filter(Boolean);
}

/**
 * Retorna lista de { name, pos } onde pos é a posição absoluta (document) da aparição do NOME na declaração.
 * Isso permite ignorar essa ocorrência quando buscarmos usos reais no corpo.
 */
function findVarDecls(bodyRaw, bodyOffset, regex) {
    const decls = [];
    let d;
    while ((d = regex.exec(bodyRaw)) !== null) {
        const name = d[d.length - 1];
        const full = d[0];
        const nameIndexInFull = full.indexOf(name);
        const namePos = bodyOffset + d.index + nameIndexInFull;
        decls.push({ name, pos: namePos });
    }
    return decls;
}

/**
 * names: [nome1, nome2, ...] (ordem de declaração)
 * bodyRaw, bodyOffset: corpo + offset absoluto
 * declPositions: lista [{name,pos,len}] para excluir matches que sejam parte da declaração
 *
 * Regra implementada:
 * - percorre todas as ocorrências REAIS (excluindo declarações)
 * - quando encontra a primeira ocorrência de uma variável X,
 *   verifica se TODAS as variáveis declaradas antes de X já tiveram primeira-uso;
 *   se não, avisa apontando a ocorrência atual.
 */
function checkOrder(names, bodyRaw, bodyOffset, diagnostics, doc, label, declPositions) {
    // normaliza declPositions para fácil checagem
    const declPosMap = (declPositions || []);

    // coleta todas as ocorrências no body (posição absoluta), excluindo-as se coincidirem com uma declaração
    const occurrences = [];
    for (const n of names) {
        const reg = new RegExp(`\\b${escapeRegExp(n)}\\b`, 'g');
        let u;
        while ((u = reg.exec(bodyRaw)) !== null) {
            const posAbs = bodyOffset + u.index;
            // ver se cai sobre alguma declaração (mesma posição do nome declarado)
            const isDeclaration = declPosMap.some(d => posAbs >= d.pos && posAbs < d.pos + (d.len || d.name.length));
            if (!isDeclaration) occurrences.push({ name: n, pos: posAbs });
        }
    }

    // ordenar por posição no arquivo
    occurrences.sort((a,b) => a.pos - b.pos);

    const firstUsed = new Set();

    for (const occ of occurrences) {
        if (!firstUsed.has(occ.name)) {
            const idx = names.indexOf(occ.name);
            if (idx === -1) { firstUsed.add(occ.name); continue; }
            // todas as variáveis declaradas antes devem já ter sido usadas
            const notUsedBefore = names.slice(0, idx).filter(n => !firstUsed.has(n));
            if (notUsedBefore.length > 0) {
                const range = new vscode.Range(
                    doc.positionAt(occ.pos),
                    doc.positionAt(occ.pos + occ.name.length)
                );
                diagnostics.push(new vscode.Diagnostic(
                    range,
                    `${label} "${occ.name}" foi usada antes de ${notUsedBefore.join(', ')} terem sido usadas.`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
            firstUsed.add(occ.name);
        }
    }
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { activate, deactivate };
