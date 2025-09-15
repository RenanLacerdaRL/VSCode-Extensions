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
    // patterns: função declarada com 'function' e métodos (nome(params) { ... })
    const patterns = [
        /(?:async\s+)?function\s+\w*\s*\(([^)]*)\)\s*/g,     // function foo(...) { }
        /(?:async\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*/g       // foo(...) { }  (métodos/declarações)
    ];

    const keywordBlacklist = new Set(['if','for','while','switch','catch','with','else','try']);

    for (const re of patterns) {
        let m;
        while ((m = re.exec(text)) !== null) {
            // para o segundo padrão, evitar palavras-chave (if/for/while etc)
            if (re === patterns[1]) {
                const possibleName = m[1];
                if (!possibleName || keywordBlacklist.has(possibleName)) continue;
            }

            const paramsRaw = (re === patterns[0]) ? m[1] : m[2];

            const signatureEnd = m.index + m[0].length;
            // agora procuramos o próximo CHAR que não seja whitespace/nem comentário
            const nxt = findNextNonSpaceNonCommentChar(text, signatureEnd);
            if (!nxt || nxt.ch !== '{') continue; // se não houver '{' logo após, não é método
            const braceOpen = nxt.pos;
            const braceClose = findMatchingBrace(text, braceOpen);
            if (braceClose === -1) continue;

            const bodyRaw = text.substring(braceOpen + 1, braceClose);
            const bodyOffset = braceOpen + 1;

            processMethod(bodyRaw, bodyOffset, paramsRaw, diagnostics, doc);
        }
    }
}

// ---------- C# ----------
function analyzeCSharp(text, diagnostics, doc) {
    const methodRe = /\b(?:public|private|protected|internal)?\s*(?:static\s+)?(?:async\s+)?[\w<>,\s\?\[\]]+\s+(\w+)\s*\(([^)]*)\)\s*/g;

    let m;
    while ((m = methodRe.exec(text)) !== null) {
        const paramsRaw = m[2];

        const signatureEnd = m.index + m[0].length;
        const nxt = findNextNonSpaceNonCommentChar(text, signatureEnd);
        if (!nxt || nxt.ch !== '{') continue;
        const braceOpen = nxt.pos;
        if (braceOpen === -1) continue;
        const braceClose = findMatchingBrace(text, braceOpen);
        if (braceClose === -1) continue;

        const bodyRaw = text.substring(braceOpen + 1, braceClose);
        const bodyOffset = braceOpen + 1;

        processMethod(bodyRaw, bodyOffset, paramsRaw, diagnostics, doc, true);
    }
}

// ---------- PROCESSA UM MÉTODO POR VEZ ----------
function processMethod(bodyRaw, bodyOffset, paramsRaw, diagnostics, doc, isCSharp=false) {
    // --- PARÂMETROS ---
    let params = [];
    if (isCSharp) {
        params = paramsRaw.split(',')
            .map(p => p.trim().split(' ').pop())
            .filter(Boolean);
    } else {
        params = cleanParams(paramsRaw);
    }

    // --- VARIÁVEIS LOCAIS (apenas dentro deste método) ---
    // Limpa comentários e strings para evitar falsos positivos ao coletar declarações
    const cleanedBody = stripCommentsAndStrings(bodyRaw);
    const decls = findVarDecls(cleanedBody, bodyOffset);
    const varNames = decls.map(d => d.name).filter(n => !params.includes(n));

    // --- CHECAGEM DE ORDEM ---
    if (params.length > 1) checkOrder(params, bodyRaw, bodyOffset, diagnostics, doc, 'Parâmetro', []);
    if (varNames.length > 1) checkOrder(varNames, bodyRaw, bodyOffset, diagnostics, doc, 'Variável', decls);
}

// ---------- UTIL ----------

// encontra o próximo caractere que não seja whitespace ou comentário (retorna pos e ch)
function findNextNonSpaceNonCommentChar(text, posStart) {
    const len = text.length;
    let i = posStart;
    while (i < len) {
        const ch = text[i];
        // whitespace
        if (/\s/.test(ch)) { i++; continue; }

        // line comment //
        if (ch === '/' && text[i+1] === '/') {
            i += 2;
            while (i < len && text[i] !== '\n') i++;
            continue;
        }

        // block comment /* */
        if (ch === '/' && text[i+1] === '*') {
            i += 2;
            while (i < len && !(text[i] === '*' && text[i+1] === '/')) i++;
            i += 2;
            continue;
        }

        return { pos: i, ch };
    }
    return null;
}

function stripCommentsAndStrings(text) {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, '')    // /* ... */
        .replace(/\/\/.*$/mg, '')           // // ...
        .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, ''); // "..." '...' `...`
}

function findVarDecls(cleanedBody, bodyOffset) {
    const decls = [];
    const regex = /\b(?:const|let|var)\s+([A-Za-z_]\w*)\s*=/g;
    let m;
    while ((m = regex.exec(cleanedBody)) !== null) {
        const name = m[1];
        const pos = bodyOffset + m.index + m[0].indexOf(name);
        decls.push({ name, pos, len: name.length });
    }
    return decls;
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

        // line comment //
        if (ch === '/' && text[i+1] === '/') {
            i += 2;
            while (i < len && text[i] !== '\n') i++;
            continue;
        }

        // block comment /* */
        if (ch === '/' && text[i+1] === '*') {
            i += 2;
            while (i < len && !(text[i] === '*' && text[i+1] === '/')) i++;
            i += 1;
            continue;
        }

        if (ch === '{') { depth++; continue; }
        if (ch === '}') { depth--; if (depth === 0) return i; continue; }
    }
    return -1;
}

function cleanParams(raw) {
    return raw
        .split(',')
        .map(p => p.trim().split(':')[0].split('=')[0].trim())
        .map(p => p.replace(/^[\[\{].*[\}\]]$/,'').trim())
        .filter(Boolean);
}

function findVariableUsages(body, variableName, bodyOffset) {
    const usages = [];
    const pattern = new RegExp(`\\b${escapeRegExp(variableName)}\\b`, 'g');

    let match;
    while ((match = pattern.exec(body)) !== null) {
        const before = body.substring(0, match.index);
        const isDeclaration = /\b(const|let|var|[A-Za-z_]\w*)\s+$/.test(before);
        if (!isDeclaration) usages.push(bodyOffset + match.index);
    }

    return usages;
}

function checkOrder(names, bodyRaw, bodyOffset, diagnostics, doc, label, declPositions) {
    names = names.filter(n => /^[A-Za-z_]\w*$/.test(n) && n !== 'form');
    if (!names.length) return;

    const declPosMap = (declPositions || []).filter(d => names.includes(d.name));

    // comentários e strings
    const commentRanges = [];
    let m;
    const lineCommentRe = /\/\/.*$/mg;
    while ((m = lineCommentRe.exec(bodyRaw)) !== null)
        commentRanges.push([bodyOffset + m.index, bodyOffset + m.index + m[0].length]);
    const blockCommentRe = /\/\*[\s\S]*?\*\//g;
    while ((m = blockCommentRe.exec(bodyRaw)) !== null)
        commentRanges.push([bodyOffset + m.index, bodyOffset + m.index + m[0].length]);

    const stringRanges = [];
    for (let i = 0; i < bodyRaw.length; i++) {
        const ch = bodyRaw[i];
        if (ch === '\'' || ch === '"' || ch === '`') {
            const quote = ch;
            const start = i;
            i++;
            while (i < bodyRaw.length) {
                if (bodyRaw[i] === '\\') { i += 2; continue; }
                if (bodyRaw[i] === quote) break;
                i++;
            }
            const end = Math.min(i, bodyRaw.length-1);
            stringRanges.push([bodyOffset + start, bodyOffset + end + 1]);
        }
    }

    const inRanges = (pos, ranges) => ranges.some(r => pos >= r[0] && pos < r[1]);

    // ocorrências
    const occurrences = [];
    for (const n of names) {
        const usages = findVariableUsages(bodyRaw, n, bodyOffset);
        for (const posAbs of usages) {
            const isDecl = declPosMap.some(d => posAbs >= d.pos && posAbs < d.pos + (d.len || d.name.length));
            const inComment = inRanges(posAbs, commentRanges);
            const inString = inRanges(posAbs, stringRanges);
            if (!isDecl && !inComment && !inString) occurrences.push({ name: n, pos: posAbs });
        }
    }

    occurrences.sort((a,b) => a.pos - b.pos);

    const firstUsed = new Set();
    for (const occ of occurrences) {
        if (!firstUsed.has(occ.name)) {
            const idx = names.indexOf(occ.name);
            const notUsedBefore = names.slice(0, idx).filter(n => !firstUsed.has(n));
            if (notUsedBefore.length) {
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
