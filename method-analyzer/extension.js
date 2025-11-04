const vscode = require('vscode');

// ===================================================
// === Variáveis globais (Prefix Rules + Method Order)
// ===================================================
let diagnosticCollectionPrefix = null;
let diagnosticCollectionOrder = null;
let hoverProviderDisposable = null;
let outputChannel = null;

// Configurações em cache
let currentPrefixRules = null;

// Regras padrão para prefixos (caso não haja configuração)
const defaultPrefixRules = {
    "Component": ["constructor", "ngOnInit", "update", "destroy"],
    "Service": ["constructor", "init", "subscribe", "execute", "dispose"],
    "Pipe": ["transform"],
    "Directive": ["constructor", "ngOnInit", "ngOnDestroy"]
};

// ===================================================
// ================ Ativação geral ===================
// ===================================================
function activate(context) {
    outputChannel = vscode.window.createOutputChannel("RL Method Analyzer");
    outputChannel.appendLine("RL Method Analyzer extension activating...");

    diagnosticCollectionPrefix = vscode.languages.createDiagnosticCollection("rl-method-analyzer.prefix");
    diagnosticCollectionOrder = vscode.languages.createDiagnosticCollection("rl-method-analyzer.order");

    context.subscriptions.push(diagnosticCollectionPrefix, diagnosticCollectionOrder);

    // carrega configurações iniciais
    loadConfiguration();

    // hover provider para exibir prefixos permitidos
    hoverProviderDisposable = vscode.languages.registerHoverProvider(
        ['javascript', 'typescript', 'csharp'],
        { provideHover(document, position) { return provideClassHover(document, position); } }
    );
    context.subscriptions.push(hoverProviderDisposable);

    // Analisa documento ativo no momento
    if (vscode.window.activeTextEditor) {
        analyzePrefixRules(vscode.window.activeTextEditor.document);
        analyzeMethodOrder(vscode.window.activeTextEditor.document);
    }

    // event listeners
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                analyzePrefixRules(editor.document);
                analyzeMethodOrder(editor.document);
            }
        }),
        vscode.workspace.onDidChangeTextDocument(e => {
            analyzePrefixRules(e.document);
            analyzeMethodOrder(e.document);
        }),
        vscode.workspace.onDidCloseTextDocument(doc => {
            diagnosticCollectionPrefix.delete(doc.uri);
            diagnosticCollectionOrder.delete(doc.uri);
        }),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('rl.method-analyzer')) {
                outputChannel.appendLine("Configuration change detected. Reloading configuration...");
                loadConfiguration();
                if (vscode.window.activeTextEditor) {
                    analyzePrefixRules(vscode.window.activeTextEditor.document);
                    analyzeMethodOrder(vscode.window.activeTextEditor.document);
                }
            }
        })
    );

    outputChannel.appendLine("RL Method Analyzer extension activated.");
}

// ===================================================
// ===================== Config ======================
// ===================================================
function loadConfiguration() {
    outputChannel.appendLine("Loading RL Method Analyzer configuration...");

    const cfg = vscode.workspace.getConfiguration('rl.method-analyzer');

    currentPrefixRules = cfg.get('prefixRules') || defaultPrefixRules;

    outputChannel.appendLine("Loaded prefix rules: " + Object.keys(currentPrefixRules).join(", "));
}

// ===================================================
// ===================== Prefix Rules ================
// ===================================================
function analyzePrefixRules(document) {
    if (!["typescript", "typescriptreact", "javascript", "javascriptreact", "csharp"].includes(document.languageId)) return;

    // Obter texto e mascarar template strings (mantendo o mesmo comprimento para preservar offsets)
    const originalText = document.getText();
    const text = maskTemplateStrings(originalText);

    const diagnostics = [];

    const classRegex = document.languageId === "csharp"
        ? /\bclass\s+([A-Za-z_]\w*)\b/g
        : /\b(?:export\s+)?class\s+([A-Za-z_]\w*)\b/g;

    // obter ignoreMethods da configuração (usado agora também como suffix-ignore para classes)
    const cfg = vscode.workspace.getConfiguration('rl.method-analyzer');
    const ignoreMethods = cfg.get('ignoreMethods') || [];

    let classMatch;
    while ((classMatch = classRegex.exec(text)) !== null) {
        const className = classMatch[1];
        const classIndex = classMatch.index;

        // Se o nome da classe terminar com algum item de ignoreMethods => pula a verificação dessa classe
        if (classNameEndsWithAny(className, ignoreMethods)) {
            continue;
        }

        const braceOpenIndex = text.indexOf("{", classIndex);
        if (braceOpenIndex === -1) continue;
        const braceCloseIndex = findMatchingBrace(text, braceOpenIndex);
        if (braceCloseIndex === -1) continue;

        const classBody = text.slice(braceOpenIndex + 1, braceCloseIndex);
        let methods = [];

        if (document.languageId === "csharp") {
            const methodRegex = /\b(?:public|private|protected|internal|static|async|virtual|override|sealed|extern|new|readonly|unsafe|abstract)\s+[\w<>\[\]]+\s+(\w+)\s*\(/g;
            methods = [...classBody.matchAll(methodRegex)].map(m => m[1]);
        } else {
            const methodRegex = /(?:\b(?:public|private|protected|static|async|readonly|abstract|virtual)\b[ \t]*)*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g;
            methods = [...classBody.matchAll(methodRegex)].map(m => m[1]);
        }

        checkPrefixOrder(document, className, methods, diagnostics, classIndex);
    }

    diagnosticCollectionPrefix.set(document.uri, diagnostics);
}

/**
 * Checa as regras de prefixo para a classe.
 * Nota: removido o Unknown Symbol — mensagem simples quando não há regra.
 */
function checkPrefixOrder(document, className, methods, diagnostics, classOffset) {
    const rules = currentPrefixRules;

    let ruleKey = null;
    for (const key of Object.keys(rules)) {
        const suffixes = key.split(',').map(s => s.trim());
        for (const suf of suffixes) {
            if (className.endsWith(suf)) {
                ruleKey = key;
                break;
            }
        }
        if (ruleKey) break;
    }

    if (!ruleKey) {
        const range = findClassNameRange(document, className, classOffset);
        diagnostics.push(new vscode.Diagnostic(
            range,
            `Classe "${className}" não possui regra definida.`,
            vscode.DiagnosticSeverity.Information
        ));
        return;
    }

    const allowedPrefixes = rules[ruleKey];

    // se a regra inclui "Any", então os métodos precisam corresponder a rl.method-analyzer.order
    const cfg = vscode.workspace.getConfiguration('rl.method-analyzer');
    const globalOrder = cfg.get('order') || [];

    const offendingMethods = [];

    for (const methodName of methods) {
        if (allowedPrefixes.includes("Any")) {
            // exige que methodName comece com um dos prefixes em globalOrder
            if (!Array.isArray(globalOrder) || globalOrder.length === 0) {
                // sem ordem configurada -> considera inválido (gera aviso)
                offendingMethods.push(methodName);
            } else {
                const matchesOrder = globalOrder.some(pref => new RegExp(`^${pref}(?![a-z])`).test(methodName));
                if (!matchesOrder) {
                    offendingMethods.push(methodName);
                }
            }
        } else {
            const matches = allowedPrefixes.some(prefix => methodName.startsWith(prefix));
            if (!matches) {
                offendingMethods.push(methodName);
            }
        }
    }

    if (offendingMethods.length > 0) {
        const range = findClassNameRange(document, className, classOffset);
        let message;
        if (allowedPrefixes.includes("Any")) {
            if (!Array.isArray(globalOrder) || globalOrder.length === 0) {
                message = `Regra "Any" aplicada à classe "${className}", mas rl.method-analyzer.order está vazio; métodos inválidos: ${offendingMethods.join(', ')}. Defina rl.method-analyzer.order.`;
            } else {
                message = `Alguns métodos da classe "${className}" não correspondem a nenhum prefixo de rl.method-analyzer.order (${globalOrder.join(', ')}): ${offendingMethods.join(', ')}.`;
            }
        } else {
            message = `Alguns métodos da classe "${className}" não seguem os prefixos esperados: ${offendingMethods.join(', ')}.`;
        }

        diagnostics.push(new vscode.Diagnostic(
            range,
            message,
            vscode.DiagnosticSeverity.Warning
        ));
    }
}

function provideClassHover(document, position) {
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/);
    if (!wordRange) return null;
    const word = document.getText(wordRange);

    const text = maskTemplateStrings(document.getText());
    const classRegex = /\b(?:export\s+)?class\s+([A-Za-z_]\w*)\b/g;

    let classMatch;
    while ((classMatch = classRegex.exec(text)) !== null) {
        const className = classMatch[1];
        if (className !== word) continue;

        let ruleKey = null;
        for (const key of Object.keys(currentPrefixRules)) {
            const suffixes = key.split(',').map(s => s.trim());
            for (const suf of suffixes) {
                if (className.endsWith(suf)) {
                    ruleKey = key;
                    break;
                }
            }
            if (ruleKey) break;
        }

        if (!ruleKey) return null;

        const allowedPrefixes = currentPrefixRules[ruleKey];
        const md = new vscode.MarkdownString(`Prefixos permitidos:\n- ${allowedPrefixes.join("\n- ")}`);
        md.isTrusted = false;
        return new vscode.Hover(md, wordRange);
    }

    return null;
}

// ===================================================
// ===================== Method Order ================
// ===================================================
function analyzeMethodOrder(document) {
    const langs = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'csharp'];
    if (!langs.includes(document.languageId)) {
        diagnosticCollectionOrder.delete(document.uri);
        return;
    }

    const originalText = document.getText();
    const text = maskTemplateStrings(originalText); // mantém índices

    // Avoid matching URLs by only catching // not preceded by ':'
    const commentRegex = /(?<!:)\/\/.*$/gm;
    const commentPositions = [];
    let cMatch;
    while ((cMatch = commentRegex.exec(text)) !== null) {
        commentPositions.push(cMatch.index);
    }

    const controlKeywords = ['if', 'for', 'foreach', 'forof', 'for of', 'while', 'switch', 'catch', 'else', 'do', 'try'];
    const config = vscode.workspace.getConfiguration('rl.method-analyzer');
    const prefixOrders = config.get('order') || [];
    const enforceCallOrder = config.get('enforceCallOrder') === true;
    const enforceAlphabeticalOrder = config.get('enforceAlphabeticalOrder') === true;
    const alphabeticalOnlyPrefixes = config.get('alphabeticalOnlyPrefixes') || [];
    const ignoreMethods = config.get('ignoreMethods') || [];

    const classRegex = /(?:export\s+)?class\s+(\w+)/;
    const classMatch = classRegex.exec(text);
    const className = classMatch ? classMatch[1] : '';

    // NOVO: se o nome da classe terminar com algum item de ignoreMethods -> ignorar completamente esta classe
    if (className && classNameEndsWithAny(className, ignoreMethods)) {
        diagnosticCollectionOrder.set(document.uri, []); // limpa diagnósticos para este documento
        return;
    }

    const ignoreUnknownPrefixes = alphabeticalOnlyPrefixes.some(suffix => className.endsWith(suffix));

    const methodRegex = /^\s*(?:public|protected|private|internal)?\s*(?:static\s*)?(?:async\s*)?(?:[\w<>\[\],\s]+\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[\w<>\[\],\s]+)?\s*\{/gm;

    const methods = [];
    let mMatch;
    while ((mMatch = methodRegex.exec(text)) !== null) {
        const name = mMatch[1];
        if (controlKeywords.includes(name)) continue;
        if (ignoreMethods.includes(name)) continue; // mantém comportamento antigo: ignora métodos com esses nomes
        const methodStart = mMatch.index;
        const nameStart = methodStart + mMatch[0].indexOf(name);
        methods.push({ name, start: methodStart, nameStart });
    }

    // enforceCallOrder -> constrói mapa de chamadas e primeiro chamador
    let firstCaller = {};
    if (enforceCallOrder) {
        for (let i = 0; i < methods.length; i++) {
            const m = methods[i];
            const bodyStart = text.indexOf('{', m.start);
            if (bodyStart === -1) continue;
            let braceCount = 1, j = bodyStart + 1;
            while (j < text.length && braceCount > 0) {
                if (text[j] === '{') braceCount++;
                else if (text[j] === '}') braceCount--;
                j++;
            }
            let body = text.slice(bodyStart + 1, j - 1);
            // remove comentários e blocos de comentário dentro do body
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
            // note: não precisamos guardar callMap completo para as regras atuais
        }
    }

    const diagnostics = [];

    // Regras de prefixos desconhecidos (quando não se aplica alphabetical-only)
    if (!ignoreUnknownPrefixes) {
        methods.forEach(m => {
            if (m.name === className) return;

            const hasPrefix = prefixOrders.some(pref => new RegExp(`^${pref}(?![a-z])`).test(m.name));
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

    // Se a classe usa apenas ordenação alfabética (ignoreUnknownPrefixes) e enforceAlphabeticalOrder
    if (ignoreUnknownPrefixes && enforceAlphabeticalOrder) {
        let lastPrefix = null;
        let lastMethodName = null;

        methods.forEach((m, idx) => {
            if (m.name === 'constructor') {
                if (idx > 0) {
                    const pos = document.positionAt(m.nameStart);
                    diagnostics.push(new vscode.Diagnostic(
                        new vscode.Range(pos, pos.translate(0, m.name.length)),
                        `O "constructor" deve vir antes de todos os outros métodos.`,
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
                return;
            }

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

        diagnosticCollectionOrder.set(document.uri, diagnostics);
        return;
    }

    // Regras de ordem por prefixOrder e enforceCallOrder/enforceAlphabeticalOrder
    let lastIdx = -1;
    let lastMethod = null;
    let commentIdx = 0;
    let lastPref = null;

    methods.forEach(m => {
        // se houve comentário antes deste método, resetamos sequência (ignora agrupamento sobre comentário)
        while (commentIdx < commentPositions.length && commentPositions[commentIdx] < m.start) {
            lastIdx = -1;
            lastMethod = null;
            lastPref = null;
            commentIdx++;
        }

        // enforceCallOrder: se método for chamado por outro, precisa estar abaixo (i.e. index maior)
        if (enforceCallOrder && firstCaller[m.name] !== undefined) {
            const callerIdx = firstCaller[m.name];
            const callerMethod = methods[callerIdx];
            const mIdx = methods.indexOf(m);
            if (mIdx <= callerIdx) {
                const pos = document.positionAt(m.nameStart);
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(pos, pos.translate(0, m.name.length)),
                    `O método "${m.name}" precisa estar abaixo de "${callerMethod.name}".`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
            return;
        }

        const idx = prefixOrders.findIndex(pref => new RegExp(`^${pref}(?![a-z])`).test(m.name));
        if (idx >= 0) {
            if (lastMethod && idx < lastIdx) {
                const pos = document.positionAt(m.nameStart);
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(pos, pos.translate(0, m.name.length)),
                    `O método "${m.name}" precisa estar acima de "${lastMethod.name}".`,
                    vscode.DiagnosticSeverity.Warning
                ));
            } else if (enforceAlphabeticalOrder && lastIdx === idx && lastPref === prefixOrders[idx]) {
                if (m.name.localeCompare(lastMethod.name) < 0) {
                    const pos = document.positionAt(m.nameStart);
                    diagnostics.push(new vscode.Diagnostic(
                        new vscode.Range(pos, pos.translate(0, m.name.length)),
                        `O método "${m.name}" está fora de ordem alfabética dentro do prefixo "${prefixOrders[idx]}".`,
                        vscode.DiagnosticSeverity.Hint
                    ));
                }
            }
            lastIdx = idx;
            lastMethod = m;
            lastPref = prefixOrders[idx];
        }
    });

    diagnosticCollectionOrder.set(document.uri, diagnostics);
}

// ===================================================
// ===================== Helpers =====================
// ===================================================

/**
 * Substitui trechos entre crases (`...`) por espaços mantendo o mesmo comprimento,
 * de modo a preservar offsets/posições em relação ao documento original.
 */
function maskTemplateStrings(text) {
    let result = '';
    let inside = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '`') {
            inside = !inside;
            continue; // não adiciona as crases nem o conteúdo
        }
        if (!inside) result += ch;
    }

    return result;
}

function findMatchingBrace(text, startIndex) {
    if (startIndex < 0 || startIndex >= text.length || text[startIndex] !== "{") return -1;
    let depth = 0;
    for (let i = startIndex; i < text.length; i++) {
        const ch = text[i];
        if (ch === "{") depth++;
        else if (ch === "}") { depth--; if (depth === 0) return i; }
    }
    return -1;
}

function findClassNameRange(document, className, offsetInMaskedText) {
    const fullText = document.getText();
    const sliceFromOffset = fullText.slice(offsetInMaskedText);
    const idx = sliceFromOffset.indexOf(className);
    if (idx === -1) {
        // fallback: busca globalmente
        const globalIdx = fullText.indexOf(className);
        if (globalIdx === -1) {
            const pos = document.positionAt(0);
            return new vscode.Range(pos, pos);
        }
        const start = document.positionAt(globalIdx);
        return new vscode.Range(start, document.positionAt(document.offsetAt(start) + className.length));
    }
    const start = document.positionAt(offsetInMaskedText + idx);
    return new vscode.Range(start, document.positionAt(document.offsetAt(start) + className.length));
}

function classNameEndsWithAny(className, suffixList) {
    if (!className || !Array.isArray(suffixList) || suffixList.length === 0) return false;
    return suffixList.some(suf => {
        if (!suf || typeof suf !== 'string') return false;
        return className.endsWith(suf);
    });
}

// ===================================================
// ===================== Export ======================
// ===================================================
function deactivate() {
    if (diagnosticCollectionPrefix) diagnosticCollectionPrefix.dispose();
    if (diagnosticCollectionOrder) diagnosticCollectionOrder.dispose();
    if (hoverProviderDisposable) hoverProviderDisposable.dispose();
    if (outputChannel) outputChannel.dispose();
}

module.exports = { activate, deactivate };
