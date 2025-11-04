const vscode = require('vscode');

let diagnosticCollection;
let hoverProviderDisposable;
let unknownClassDecoration;
let lastDecoratedEditor = null;
let outputChannel;

// configurações carregadas
let currentPrefixRules = null;
let currentUnknownSymbol = "⚠️";

// default (exemplo inicial)
const defaultPrefixRules = {
    "Component": ["constructor", "ngOnInit", "update", "destroy"],
    "Service": ["constructor", "init", "subscribe", "execute", "dispose"],
    "Pipe": ["transform"],
    "Directive": ["constructor", "ngOnInit", "ngOnDestroy"]
};

function activate(context) {
    outputChannel = vscode.window.createOutputChannel("Prefix Rules");
    outputChannel.appendLine("Prefix Rules extension activating...");

    diagnosticCollection = vscode.languages.createDiagnosticCollection("prefix-rules");
    context.subscriptions.push(diagnosticCollection);

    loadConfiguration();

    hoverProviderDisposable = vscode.languages.registerHoverProvider(
        ['javascript', 'typescript', 'csharp'],
        { provideHover(document, position) { return provideClassHover(document, position); } }
    );
    context.subscriptions.push(hoverProviderDisposable);

    if (vscode.window.activeTextEditor) updateDiagnostics(vscode.window.activeTextEditor.document);

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => { if (editor) updateDiagnostics(editor.document); }),
        vscode.workspace.onDidChangeTextDocument(e => { updateDiagnostics(e.document); }),
        vscode.workspace.onDidCloseTextDocument(doc => {
            diagnosticCollection.delete(doc.uri);
            if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.toString() === doc.uri.toString()) {
                if (unknownClassDecoration) vscode.window.activeTextEditor.setDecorations(unknownClassDecoration, []);
                lastDecoratedEditor = null;
            }
        }),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('rl.prefix-order') ||
                e.affectsConfiguration('rl.prefix-order.rules') ||
                e.affectsConfiguration('rl.prefix-order.unknownSymbol')) {
                outputChannel.appendLine("Configuration change detected. Reloading configuration...");
                loadConfiguration();
                if (vscode.window.activeTextEditor) updateDiagnostics(vscode.window.activeTextEditor.document);
            }
        })
    );

    outputChannel.appendLine("Prefix Rules extension activated.");
}

function deactivate() {
    if (diagnosticCollection) diagnosticCollection.dispose();
    if (hoverProviderDisposable) hoverProviderDisposable.dispose();
    if (unknownClassDecoration) unknownClassDecoration.dispose();
    if (outputChannel) outputChannel.dispose();
}

function loadConfiguration() {
    outputChannel.appendLine("Loading configuration...");

    const cfg = vscode.workspace.getConfiguration('rl.prefix-order');
    const rules = cfg.get('rules') || defaultPrefixRules;
    currentPrefixRules = rules;

    const sym = cfg.get('unknownSymbol') || "⚠️";
    currentUnknownSymbol = sym;

    if (unknownClassDecoration) {
        try { unknownClassDecoration.dispose(); } catch (e) {}
    }

    unknownClassDecoration = vscode.window.createTextEditorDecorationType({
        after: { contentText: " " + currentUnknownSymbol, textDecoration: "none" },
        rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen
    });

    outputChannel.appendLine("Loaded rules: " + Object.keys(currentPrefixRules).join(", "));
}

// ==========================
// ==== Lógica principal ====
// ==========================
function updateDiagnostics(document) {
    if (!["typescript", "javascript", "csharp"].includes(document.languageId)) return;

    const text = document.getText();
    const diagnostics = [];
    const unknownClassRanges = [];

    const classRegex = document.languageId === "csharp"
        ? /\bclass\s+([A-Za-z_]\w*)\b/g
        : /\b(?:export\s+)?class\s+([A-Za-z_]\w*)\b/g;

    let classMatch;
    while ((classMatch = classRegex.exec(text)) !== null) {
        const className = classMatch[1];
        const classIndex = classMatch.index;

        const braceOpenIndex = text.indexOf("{", classIndex);
        if (braceOpenIndex === -1) continue;
        const braceCloseIndex = findMatchingBrace(text, braceOpenIndex);
        if (braceCloseIndex === -1) continue;

        const bodyStart = braceOpenIndex + 1;
        const bodyEnd = braceCloseIndex;
        const classBody = text.slice(bodyStart, bodyEnd);

        // ===== extrai métodos =====
        let methods = [];
        if (document.languageId === "csharp") {
            // pega o nome do método ignorando tipo de retorno
            const methodRegex = /\b(?:public|private|protected|internal|static|async|virtual|override|sealed|extern|new|readonly|unsafe|abstract)\s+[\w<>\[\]]+\s+(\w+)\s*\(/g;
            methods = [...classBody.matchAll(methodRegex)].map(m => m[1]);
        } else {
            const methodRegex = /(?:\b(?:public|private|protected|static|async|readonly|abstract|virtual)\b[ \t]*)*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g;
            methods = [...classBody.matchAll(methodRegex)].map(m => m[1]);
        }

        checkPrefixOrder(document, className, methods, diagnostics, classIndex);
    }

    diagnosticCollection.set(document.uri, diagnostics);

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.uri.toString() === document.uri.toString()) {
        try {
            activeEditor.setDecorations(unknownClassDecoration, unknownClassRanges);
            lastDecoratedEditor = activeEditor;
        } catch (e) {}
    } else {
        if (lastDecoratedEditor) {
            try { lastDecoratedEditor.setDecorations(unknownClassDecoration, []); } catch (e) {}
            lastDecoratedEditor = null;
        }
    }
}

// ===== verifica prefixos =====
function checkPrefixOrder(document, className, methods, diagnostics, classOffset) {
    const rules = currentPrefixRules;
    const unknownSymbol = currentUnknownSymbol;

    // busca a regra pelo sufixo da classe
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
            `Classe "${className}" não possui regra definida. ${unknownSymbol}`,
            vscode.DiagnosticSeverity.Information
        ));
        return;
    }

    const allowedPrefixes = rules[ruleKey];

    // flag para disparar aviso apenas uma vez
    let hasViolation = false;

    for (const methodName of methods) {
        if (allowedPrefixes.includes("Any")) continue; // aceita qualquer prefixo
        const matches = allowedPrefixes.some(prefix => methodName.startsWith(prefix));
        if (!matches) {
            hasViolation = true;
            break; // já encontrou uma violação
        }
    }

    if (hasViolation) {
        const range = findClassNameRange(document, className, classOffset);
        diagnostics.push(new vscode.Diagnostic(
            range,
            `Alguns métodos da classe "${className}" não seguem os prefixos esperados.`,
            vscode.DiagnosticSeverity.Warning
        ));
    }
}

// ===== hover helper =====
function provideClassHover(document, position) {
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/);
    if (!wordRange) return null;
    const word = document.getText(wordRange);

    // identifica classe
    const classRegex = document.languageId === "csharp"
        ? /\bclass\s+([A-Za-z_]\w*)\b/g
        : /\b(?:export\s+)?class\s+([A-Za-z_]\w*)\b/g;

    const text = document.getText();
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
        const md = new vscode.MarkdownString(`Prefixos permitidos para esta classe:\n- ${allowedPrefixes.join("\n- ")}`);
        md.isTrusted = false;
        return new vscode.Hover(md, wordRange);
    }

    return null;
}

// ===== helpers =====
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

function findClassNameRange(document, className, offset) {
    const start = document.positionAt(offset + document.getText().slice(offset).indexOf(className));
    return new vscode.Range(start, document.positionAt(document.offsetAt(start) + className.length));
}

function findMethodRange(document, methodName, offset) {
    const start = document.positionAt(offset + document.getText().slice(offset).indexOf(methodName));
    return new vscode.Range(start, document.positionAt(document.offsetAt(start) + methodName.length));
}

module.exports = { activate, deactivate };
