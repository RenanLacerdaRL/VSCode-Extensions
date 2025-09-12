const vscode = require('vscode');

let diagnosticCollection;
let hoverProviderDisposable;
let unknownClassDecoration; // decoration type (re-criado quando a config muda)
let lastDecoratedEditor = null;
let outputChannel;

// configurações carregadas (serão sobrescritas por loadConfiguration)
let currentClassRules = null;
let currentUnknownSymbol = "🔹";

// Default rules (usadas se realmente não existir nenhuma configuração em nenhum escopo)
const defaultClassRules = {
    "Formatter": { startWith: "To", checkFirstParam: true, checkReturn: true },
    "Checker": { checkFirstParam: true, checkReturn: true },
    "Matcher": { checkFirstParam: true, checkReturn: true },
    "Retriever": { startWith: "Get", checkFirstParam: true, checkReturn: true },
    "Converter": { startWith: "To", checkFirstParam: true, checkReturn: true  },
    "Factory": { startWith: "Create", checkReturn: true },
    "Finder": { startWith: "By", checkFirstParam: true, returnRelated: true, useError: true },
    "Filter": { startWith: "By", checkFirstParam: true, returnRelated: true },
    "Sorter": { startWith: "By", checkFirstParam: true, returnRelated: true },
    "Provider": { startWith: "Get", checkReturn: true },
    "Handler": { checkFirstParam: true, doSomething: true },
    "Calculator": { checkReturn: true },
    "Modifier": { checkFirstParam: true, returnRelated: true },
    "Exception": { throwAll: true },
    "Configuration": { checkReturn: true },
    "Builder": { checkReturn: true },
    "Headers,Urls": { checkReturn: true },
    "Messages": { checkReturn: true },
    "Service": { doSomething: true },
    "Pipe,Form,Select": { extension:true },
    "Data": { variables:true },
    "Component": {expansion:true, injectable:true, manager:true }
};

function activate(context) {
    outputChannel = vscode.window.createOutputChannel("Class Rules");
    outputChannel.appendLine("Class Rules extension activating...");

    diagnosticCollection = vscode.languages.createDiagnosticCollection("class-rules");
    context.subscriptions.push(diagnosticCollection);

    // carrega configuração inicial e cria decoration
    loadConfiguration();

    // Registra hover provider (dinâmico)
    hoverProviderDisposable = vscode.languages.registerHoverProvider(
        ['javascript', 'typescript', 'csharp'],
        { provideHover(document, position) { return provideClassHover(document, position); } }
    );
    context.subscriptions.push(hoverProviderDisposable);

    if (vscode.window.activeTextEditor) updateDiagnostics(vscode.window.activeTextEditor.document);

    // re-executa ao trocar editor/editar documento/fechar
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => { if (editor) updateDiagnostics(editor.document); }),
        vscode.workspace.onDidChangeTextDocument(e => { updateDiagnostics(e.document); }),
        vscode.workspace.onDidCloseTextDocument(doc => {
            diagnosticCollection.delete(doc.uri);
            if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.toString() === doc.uri.toString()) {
                if (unknownClassDecoration) vscode.window.activeTextEditor.setDecorations(unknownClassDecoration, []);
                lastDecoratedEditor = null;
            }
        })
    );

    // quando settings mudarem, recarrega configuração e atualiza tudo
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        // reagir se a mudança afetar nossas keys (somente classRules)
        if (e.affectsConfiguration('classRules') || e.affectsConfiguration('classRules.rules') || e.affectsConfiguration('classRules.unknownSymbol')) {
            outputChannel.appendLine("Configuration change detected. Reloading configuration...");
            loadConfiguration();
            if (vscode.window.activeTextEditor) updateDiagnostics(vscode.window.activeTextEditor.document);
        }
    }));

    outputChannel.appendLine("Class Rules extension activated.");
}

function deactivate() {
    if (diagnosticCollection) diagnosticCollection.dispose();
    if (hoverProviderDisposable) hoverProviderDisposable.dispose();
    if (unknownClassDecoration) unknownClassDecoration.dispose();
    if (outputChannel) outputChannel.dispose();
}

// Carrega configuração do usuário / aplica defaults e recria decoration se necessário
function loadConfiguration() {
    outputChannel.appendLine("Loading configuration from settings...");

    // tenta ler 'classRules' com inspect para saber escopos
    const cfg = vscode.workspace.getConfiguration('classRules');
    const inspected = cfg.inspect('rules'); // { key, defaultValue, globalValue (user), workspaceValue, workspaceFolderValue }
    let cfgRules = undefined;
    let sourceInfo = null;

    // preferência por escopo mais específico: workspaceFolder > workspace > user > default
    if (inspected) {
        if (inspected.workspaceFolderValue !== undefined) { cfgRules = inspected.workspaceFolderValue; sourceInfo = 'classRules.rules (workspaceFolder)'; }
        else if (inspected.workspaceValue !== undefined) { cfgRules = inspected.workspaceValue; sourceInfo = 'classRules.rules (workspace)'; }
        else if (inspected.globalValue !== undefined) { cfgRules = inspected.globalValue; sourceInfo = 'classRules.rules (user)'; }
        else if (inspected.defaultValue !== undefined) { cfgRules = inspected.defaultValue; sourceInfo = 'classRules.rules (default)'; }
    }

    // se ainda undefined, usar defaultClassRules (sinalizo que veio de default)
    if (cfgRules === undefined || cfgRules === null) {
        currentClassRules = defaultClassRules;
        outputChannel.appendLine("No explicit classRules found in settings; using defaultClassRules.");
        sourceInfo = sourceInfo || 'defaultClassRules';
    } else {
        // se o usuário explicitamente colocou {} (vazio) em algum escopo, respeitamos isso — currentClassRules será {}
        currentClassRules = cfgRules;
        outputChannel.appendLine(`Loaded classRules from: ${sourceInfo}`);
        try { outputChannel.appendLine("classRules keys: " + Object.keys(currentClassRules).join(", ")); } catch (e) {}
    }

    // símbolo: mesma lógica
    let sym = undefined;
    const inspectedSym = cfg.inspect('unknownSymbol');
    let symSource = null;
    if (inspectedSym) {
        if (inspectedSym.workspaceFolderValue !== undefined) { sym = inspectedSym.workspaceFolderValue; symSource = 'classRules.unknownSymbol (workspaceFolder)'; }
        else if (inspectedSym.workspaceValue !== undefined) { sym = inspectedSym.workspaceValue; symSource = 'classRules.unknownSymbol (workspace)'; }
        else if (inspectedSym.globalValue !== undefined) { sym = inspectedSym.globalValue; symSource = 'classRules.unknownSymbol (user)'; }
        else if (inspectedSym.defaultValue !== undefined) { sym = inspectedSym.defaultValue; symSource = 'classRules.unknownSymbol (default)'; }
    }
    currentUnknownSymbol = (typeof sym === 'string' && sym.length > 0) ? sym : "🔹";
    outputChannel.appendLine(`Using unknownSymbol "${currentUnknownSymbol}" from ${symSource || 'default/none'}`);

    // (re)cria unknownClassDecoration com novo símbolo
    if (unknownClassDecoration) {
        try { unknownClassDecoration.dispose(); } catch (e) { /* ignore */ }
    }
    unknownClassDecoration = vscode.window.createTextEditorDecorationType({
        after: {
            contentText: " " + currentUnknownSymbol,
            textDecoration: "none"
        },
        rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen
    });
}

// helper: detecta se inspected result tinha algum valor explícito em user/workspace/workspaceFolder
function hasExplicitValue(inspected) {
    if (!inspected) return false;
    return (inspected.workspaceFolderValue !== undefined) || (inspected.workspaceValue !== undefined) || (inspected.globalValue !== undefined);
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

    const controlKeywords = ["if","for","while","switch","catch","try","else","do","using","lock","return","throw","break","continue"].join("|");
    const methodRegex = new RegExp(
        '(^|\\r?\\n)\\s*' +
        '(?:\\b(?:public|private|protected|static|async|readonly|abstract|virtual)\\b[\\s]*)*' +
        '(?!\\b(?:' + controlKeywords + ')\\b)' +
        '([A-Za-z_$][\\w$]*)\\s*\\(([^)]*)\\)\\s*\\{',
        'g'
    );

    let classMatch;
    while ((classMatch = classRegex.exec(text)) !== null) {
        const fullClassName = classMatch[1];
        const classDeclIndex = classMatch.index;

        // posição do nome da classe dentro do documento
        const matchText = classMatch[0];
        const idxOfName = matchText.indexOf(fullClassName);
        const classNameGlobalIndex = classDeclIndex + (idxOfName >= 0 ? idxOfName : 0);
        const classNameStartPos = document.positionAt(classNameGlobalIndex);
        const classNameEndPos = document.positionAt(classNameGlobalIndex + fullClassName.length);

        const braceOpenIndex = text.indexOf("{", classDeclIndex);
        if (braceOpenIndex === -1) {
            const classType = getClassType(fullClassName);
            if (!classType) unknownClassRanges.push(new vscode.Range(classNameStartPos, classNameEndPos));
            continue;
        }
        const braceCloseIndex = findMatchingBrace(text, braceOpenIndex);
        if (braceCloseIndex === -1) {
            const classType = getClassType(fullClassName);
            if (!classType) unknownClassRanges.push(new vscode.Range(classNameStartPos, classNameEndPos));
            continue;
        }

        const bodyStart = braceOpenIndex + 1;
        const bodyEnd = braceCloseIndex;
        const classBody = text.slice(bodyStart, bodyEnd);

        const classType = getClassType(fullClassName);
        if (!classType) {
            unknownClassRanges.push(new vscode.Range(classNameStartPos, classNameEndPos));
            continue;
        }

        const rules = currentClassRules[classType];
        const baseName = fullClassName.replace(new RegExp("(" + classType.split(",").join("|") + ")$"), "");

        // percorre métodos e aplica regras
        let methodMatch;
        while ((methodMatch = methodRegex.exec(classBody)) !== null) {
            const methodName = methodMatch[2];
            const paramsString = methodMatch[3] || "";
            const methodMatchIndexInClassBody = methodMatch.index;
            const idxOfOpenBraceInMatch = methodMatch[0].lastIndexOf("{");
            const methodOpenBraceIndexInClassBody = methodMatchIndexInClassBody + idxOfOpenBraceInMatch;
            const methodBodyStartGlobal = bodyStart + methodOpenBraceIndexInClassBody + 1;
            const methodBodyCloseGlobal = findMatchingBrace(text, methodBodyStartGlobal - 1);
            const methodNameIndexInMatch = methodMatch[0].indexOf(methodName);
            const methodNameGlobalIndex = bodyStart + methodMatchIndexInClassBody + methodNameIndexInMatch;

            const startPos = document.positionAt(methodNameGlobalIndex);
            const endPos = document.positionAt(methodNameGlobalIndex + methodName.length);

            let methodBodyText = "";
            if (methodBodyStartGlobal !== -1 && methodBodyCloseGlobal !== -1 && methodBodyCloseGlobal > methodBodyStartGlobal) {
                methodBodyText = text.slice(methodBodyStartGlobal, methodBodyCloseGlobal);
            }

            applyRules(document, diagnostics, fullClassName, baseName, methodName, paramsString, startPos, endPos, text, rules, methodBodyText);
        }
    }

    diagnosticCollection.set(document.uri, diagnostics);

    // aplica decorações no editor ativo
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.uri.toString() === document.uri.toString()) {
        try {
            activeEditor.setDecorations(unknownClassDecoration, unknownClassRanges);
            lastDecoratedEditor = activeEditor;
        } catch (e) { /* se algo falhar não crashar extensão */ }
    } else {
        if (lastDecoratedEditor) {
            try { lastDecoratedEditor.setDecorations(unknownClassDecoration, []); } catch (e) {}
            lastDecoratedEditor = null;
        }
    }
}

// ===== Hover helper (dinâmico a partir de currentClassRules) =====
function provideClassHover(document, position) {
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/);
    if (!wordRange) return null;
    const word = document.getText(wordRange);

    const classRegex = document.languageId === "csharp"
        ? /\bclass\s+([A-Za-z_]\w*)\b/g
        : /\b(?:export\s+)?class\s+([A-Za-z_]\w*)\b/g;

    const text = document.getText();
    let classMatch;
    while ((classMatch = classRegex.exec(text)) !== null) {
        const className = classMatch[1];
        if (className !== word) continue;

        const classType = getClassType(className);
        if (!classType) return null;
        const rules = currentClassRules[classType];
        if (!rules) return null;

        const lines = [];
        if (rules.startWith) lines.push(`- Todos os métodos iniciam com \`${rules.startWith}\`.`);
        if (rules.checkFirstParam || rules.checkFirstParam === true) lines.push(`- O primeiro parâmetro deve ter relação com a \`classe\`.`);
        if (rules.checkReturn) lines.push(`- Todos os métodos devem ser \`return\`.`);
        if (rules.returnType) {
            if (rules.returnType === "bool") lines.push(`- Todos os métodos devem retornar do tipo \`boolean\`.`);
            else lines.push(`- Todos os métodos devem retornar do tipo \`${rules.returnType}\`.`);
        }
        if (rules.returnRelated) lines.push(`- O valor de retorno deve ter relação com a \`classe\`.`);
        if (rules.doSomething) lines.push(`- Métodos devem executar funções de \`objetos\`.`);
        if (rules.variables) lines.push(`- Métodos só devem executar funções relacionadas as \`variaveis\`.`);
        if (rules.expansion) lines.push(`- Se existir mais de uma variável do mesmo tipo, devem estar na expanção do \`componente\`.`);
        if (rules.injectable) lines.push(`- Classes que não são \`injectables\` ou \`statics\` devem ser expanções do \`componente\`.`);
        if (rules.manager) lines.push(`- Métodos só devem executar funções \`sequenciais\` nunca calculando algo.`);
        if (rules.extension) lines.push(`- A classe pertence a uma \`extensão\` ou \`implementação\`.`);
        if (rules.useError) lines.push(`- Usar \`Error\` caso não encontre o valor.`);
        if (rules.throwAll) lines.push(`- Usar \`throw\` em todos os métodos.`);

        const md = new vscode.MarkdownString(lines.join("\n"));
        md.isTrusted = false;
        return new vscode.Hover(md, wordRange);
    }

    return null;
}

// ===== Funções auxiliares =====
function getClassType(className) {
    for (const key in currentClassRules) {
        const suffixes = key.split(",");
        if (suffixes.some(s => className.endsWith(s))) return key;
    }
    return null;
}

// tenta inferir se o return é relacionado ao baseName
function isReturnRelated(document, fullText, methodBodyText, paramsString, baseName) {
    const baseLower = baseName.toLowerCase();
    const returnMatches = [...methodBodyText.matchAll(/return\s+([^;]+);?/g)];
    if (returnMatches.length === 0) return false;

    const paramMap = {};
    const params = paramsString.split(",").map(p=>p.trim()).filter(p=>p.length>0);
    for (const p of params) {
        if (!p) continue;
        if (document.languageId === "csharp") {
            const parts = p.split(/\s+/).filter(s=>s.length>0);
            if (parts.length >= 2) paramMap[parts[1]] = parts[0].toLowerCase();
            else paramMap[parts[0]] = "";
        } else {
            const parts = p.split(":").map(s=>s.trim());
            paramMap[parts[0]] = (parts[1]||"").toLowerCase();
        }
    }

    const varDeclRegex = /(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z0-9_<>\[\]\.]+))?/g;
    const varTypes = {};
    let vd;
    while ((vd = varDeclRegex.exec(methodBodyText)) !== null) {
        const name = vd[1];
        const typ = (vd[2] || "").toLowerCase();
        if (typ) varTypes[name] = typ;
    }

    for (const m of returnMatches) {
        let ret = m[1].trim();
        ret = ret.replace(/^\(+/, "").replace(/\)+$/, "").split(/\s*[\.\[]/)[0].trim();

        if (/^(true|false)$/.test(ret)) continue;
        if (/^['"`].*['"`]$/.test(ret)) continue;
        if (/^[0-9]+(\.[0-9]+)?$/.test(ret)) continue;

        if (/^[A-Za-z_$][\w$]*$/.test(ret)) {
            const name = ret;
            if (paramMap[name]) {
                const t = paramMap[name];
                if (t.includes(baseLower)) return true;
                if (t.replace(/\[\]$/, "").includes(baseLower)) return true;
            }
            if (varTypes[name]) {
                const t = varTypes[name];
                if (t.includes(baseLower)) return true;
                if (t.replace(/\[\]$/, "").includes(baseLower)) return true;
            }
            if (name.toLowerCase().includes(baseLower)) return true;
            continue;
        }

        const rootIdMatch = ret.match(/^([A-Za-z_$][\w$]*)\b/);
        if (rootIdMatch) {
            const root = rootIdMatch[1];
            if (paramMap[root] && paramMap[root].includes(baseLower)) return true;
            if (varTypes[root] && varTypes[root].includes(baseLower)) return true;
            if (root.toLowerCase().includes(baseLower)) return true;
        }
    }

    return false;
}

function applyRules(document, diagnostics, className, baseName, methodName, paramsString, startPos, endPos, fullText, rules, methodBodyText) {
    // startWith
    if (rules && rules.startWith && !methodName.startsWith(rules.startWith)) {
        diagnostics.push(new vscode.Diagnostic(new vscode.Range(startPos, endPos), `O método "${methodName}" deve começar com "${rules.startWith}" em uma classe ${className}.`, vscode.DiagnosticSeverity.Warning));
    }
    // first parameter
    if (rules && rules.checkFirstParam) {
        const params = paramsString.split(",").map(p => p.trim()).filter(p => p.length > 0);
        if (params.length > 0) {
            let firstParamName = "";
            let firstParamType = "";
            if (document.languageId === "csharp") {
                const parts = params[0].split(/\s+/).filter(s => s.length > 0);
                if (parts.length >= 2) { firstParamType = parts[0].toLowerCase(); firstParamName = parts[1]; }
                else firstParamName = parts[0] || "";
            } else {
                const parts = params[0].split(":").map(s=>s.trim());
                firstParamName = parts[0] || "";
                firstParamType = (parts[1] || "").toLowerCase();
            }
            const baseNameLower = baseName.toLowerCase();
            if (!firstParamName.toLowerCase().includes(baseNameLower) && !firstParamType.includes(baseNameLower)) {
                diagnostics.push(new vscode.Diagnostic(new vscode.Range(startPos, endPos), `O primeiro parâmetro "${firstParamName}${firstParamType ? ': ' + firstParamType : ''}" não tem relação com a classe "${className}".`, vscode.DiagnosticSeverity.Warning));
            }
        }
    }
    // checkReturn
    if (rules && rules.checkReturn) {
        if (!/return\b/.test(methodBodyText)) {
            diagnostics.push(new vscode.Diagnostic(new vscode.Range(startPos, endPos), `O método "${methodName}" deve conter pelo menos um return.`, vscode.DiagnosticSeverity.Warning));
        }
    }
    // returnType bool JS/TS (mantido)
    if (rules && rules.returnType === "bool" && (document.languageId === "typescript" || document.languageId === "javascript")) {
        const approxRangeStart = Math.max(0, document.offsetAt(startPos) - 80);
        const approxRangeEnd = Math.min(fullText.length, document.offsetAt(endPos) + 40);
        const signatureSlice = fullText.slice(approxRangeStart, approxRangeEnd);
        const typedReturn = /\)\s*:\s*boolean\b/.test(signatureSlice);

        if (!typedReturn) {
            const returnMatches = [...methodBodyText.matchAll(/return\s+([^;]+);?/g)];
            if (returnMatches.length > 0) {
                let hasBoolLiteral = false;
                let hasStringLiteralReturn = false;
                let hasNumberLiteralReturn = false;
                for (const m of returnMatches) {
                    const retVal = m[1].trim();
                    if (retVal === "true" || retVal === "false") { hasBoolLiteral = true; continue; }
                    if (/^['"`].*['"`]$/.test(retVal)) { hasStringLiteralReturn = true; continue; }
                    if (/^[0-9]+(\.[0-9]+)?$/.test(retVal)) { hasNumberLiteralReturn = true; continue; }
                }
                if (hasStringLiteralReturn || hasNumberLiteralReturn) {
                    diagnostics.push(new vscode.Diagnostic(new vscode.Range(startPos, endPos), `O método "${methodName}" em classe ${className} deve retornar boolean (true/false). Encontrado retorno literal incompatível.`, vscode.DiagnosticSeverity.Warning));
                }
            }
        }
    }
    // returnRelated (heurística)
    if (rules && rules.returnRelated) {
        const related = isReturnRelated(document, fullText, methodBodyText, paramsString, baseName);
        if (!related) {
            diagnostics.push(new vscode.Diagnostic(new vscode.Range(startPos, endPos), `O método "${methodName}" deve retornar algo relacionado à classe "${className}".`, vscode.DiagnosticSeverity.Warning));
        }
    }
    // useError: aceitar throw new Error(...) como válido
    if (rules && rules.useError) {
        const hasThrowError = /throw\s+new\s+Error\s*\(/.test(methodBodyText) || /throw\s+Error\s*\(/.test(methodBodyText) || /throw\s+[A-Za-z_$][\w$]*/.test(methodBodyText);
        if (!hasThrowError) {
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(startPos, endPos),
                `O método "${methodName}" deve usar Error caso não encontre valor.`,
                vscode.DiagnosticSeverity.Warning
            ));
        }
    }
    // mensagens informativas
    if (rules && rules.throwAll) diagnostics.push(new vscode.Diagnostic(new vscode.Range(startPos, endPos), `Todos os métodos da classe "${className}" devem usar throw para finalizar a aplicação.`, vscode.DiagnosticSeverity.Warning));
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

module.exports = { activate, deactivate };
