const vscode = require('vscode');

let diagnosticCollection;
let hoverProviderDisposable;
let unknownClassDecoration; // decoration type
let lastDecoratedEditor = null;

function activate(context) {
    diagnosticCollection = vscode.languages.createDiagnosticCollection("class-rules");
    context.subscriptions.push(diagnosticCollection);

    // cria decoration type para classes sem tipo conhecido (após o nome)
    unknownClassDecoration = vscode.window.createTextEditorDecorationType({
        after: {
            contentText: "🔹",
            textDecoration: "none"
        },
        rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen
    });
    context.subscriptions.push({ dispose: () => unknownClassDecoration.dispose() });

    // Registra hover provider (dinâmico)
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
                vscode.window.activeTextEditor.setDecorations(unknownClassDecoration, []);
                lastDecoratedEditor = null;
            }
        })
    );
}

function deactivate() {
    if (diagnosticCollection) diagnosticCollection.dispose();
    if (hoverProviderDisposable) hoverProviderDisposable.dispose();
    if (unknownClassDecoration) unknownClassDecoration.dispose();
}

// ===== Configuração das regras =====
const classRules = {
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
    "Calculator": {checkReturn: true },
    "Modifier": { checkFirstParam: true, returnRelated: true },
    "Exception": { throwAll: true },
    "Configuration": { checkReturn: true },
    "Builder": { checkReturn: true },
    "Headers,Urls": { checkReturn: true },
    "Messages": { checkReturn: true },
    "Service": { doSomething: true },
    "Pipe,Form,Select": { extension:true },
};

// ===== updateDiagnostics (faz diagnósticos e coleta classes desconhecidas para decorar) =====
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

        const rules = classRules[classType];
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
        activeEditor.setDecorations(unknownClassDecoration, unknownClassRanges);
        lastDecoratedEditor = activeEditor;
    } else {
        if (lastDecoratedEditor) {
            lastDecoratedEditor.setDecorations(unknownClassDecoration, []);
            lastDecoratedEditor = null;
        }
    }
}

// ===== Hover helper (dinâmico) =====
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
        const rules = classRules[classType];
        if (!rules) return null;

        const lines = [];
        if (rules.startWith) lines.push(`- Todos os métodos iniciam com \`${rules.startWith}\`.`);
        if (rules.checkReturn) lines.push(`- Todos os métodos devem conter \`return\`.`);
        if (rules.checkFirstParam) lines.push(`- O primeiro parâmetro deve ter relação com a classe.`);
        if (rules.returnType) {
            if (rules.returnType === "bool") lines.push(`- Todos os métodos devem retornar do tipo \`boolean\`.`);
            else lines.push(`- Todos os métodos devem retornar do tipo \`${rules.returnType}\`.`);
        }
        if (rules.returnRelated) lines.push(`- O valor de retorno deve ter relação com a classe.`);
        if (rules.useError) lines.push(`- Usar \`Error\` caso não encontre o valor.`);
        if (rules.doSomething) lines.push(`- Métodos devem executar ação própria.`);
        if (rules.throwAll) lines.push(`- Usar \`throw\` em todos os métodos.`);
        if (rules.extension) lines.push(`- A classe pertence a uma extensão/implementação.`);

        const md = new vscode.MarkdownString(lines.join("\n"));
        md.isTrusted = false;
        return new vscode.Hover(md, wordRange);
    }

    return null;
}

// ===== Funções auxiliares =====
function getClassType(className) {
    for (const key in classRules) {
        const suffixes = key.split(",");
        if (suffixes.some(s => className.endsWith(s))) return key;
    }
    return null;
}

// nova função: tenta inferir se o return é relacionado ao baseName
function isReturnRelated(document, fullText, methodBodyText, paramsString, baseName) {
    const baseLower = baseName.toLowerCase();
    // 1) verificar tipo de retorno na assinatura (TS): "): Type" próximo à posição (approx handled by caller using startPos in older versions).
    // Aqui vamos apenas procurar um padrão ") : Type" dentro do corpo do método (assume trecho já fornecido pelo caller)
    // Para ser robusto, tentamos encontrar "): <Type>" logo antes da primeira "{" do método (na fullText).
    // Se o métodoBodyText for vazio, não conseguimos; então fazemos outras tentativas abaixo.

    // 2) verificar returns literais e identificadores
    const returnMatches = [...methodBodyText.matchAll(/return\s+([^;]+);?/g)];
    if (returnMatches.length === 0) return false;

    // construir map de parâmetros name->type (se tipados)
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

    // 3) map variables declared in method: let/const/var NAME: Type = ...
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

        // remover parênteses e chamadas encadeadas ex: (resultPosts) ou resultPosts.slice(0)
        ret = ret.replace(/^\(+/, "").replace(/\)+$/, "").split(/\s*[\.\[]/)[0].trim();

        // boolean/string/number literals: not related
        if (/^(true|false)$/.test(ret)) continue; // boolean literal — not helpful for relatedness
        if (/^['"`].*['"`]$/.test(ret)) continue;
        if (/^[0-9]+(\.[0-9]+)?$/.test(ret)) continue;

        // se for um identificador, verificar:
        if (/^[A-Za-z_$][\w$]*$/.test(ret)) {
            const name = ret;
            // 3a) se for parâmetro tipado
            if (paramMap[name]) {
                const t = paramMap[name];
                if (t.includes(baseLower)) return true;
                // array of base e.g. postclass[] => includes baseLower
                if (t.replace(/\[\]$/, "").includes(baseLower)) return true;
            }
            // 3b) se for variável declarada na função com tipo
            if (varTypes[name]) {
                const t = varTypes[name];
                if (t.includes(baseLower)) return true;
                if (t.replace(/\[\]$/, "").includes(baseLower)) return true;
            }
            // 3c) se o nome contém baseLower (ex: posts -> baseName post)
            if (name.toLowerCase().includes(baseLower)) return true;
            // senão, não temos certeza — continuar tentando com próximos returns
            continue;
        }

        // se for expressão como posts.filter(...), extrair a raiz antes do ponto
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
    if (rules.startWith && !methodName.startsWith(rules.startWith)) {
        diagnostics.push(new vscode.Diagnostic(new vscode.Range(startPos, endPos), `O método "${methodName}" deve começar com "${rules.startWith}" em uma classe ${className}.`, vscode.DiagnosticSeverity.Warning));
    }
    // first parameter
    if (rules.checkFirstParam) {
        const params = paramsString.split(",").map(p => p.trim()).filter(p => p.length > 0);
        if (params.length > 0) {
            let firstParamName = "";
            let firstParamType = "";
            if (document.languageId === "csharp") {
                const parts = params[0].split(/\s+/).filter(s => s.length > 0);
                if (parts.length >= 2) { firstParamType = parts[0].toLowerCase(); firstParamName = parts[1]; }
                else firstParamName = parts[0] || "";
            } else {
                const parts = params[0].split(":").map(s => s.trim());
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
    if (rules.checkReturn) {
        if (!/return\b/.test(methodBodyText)) {
            diagnostics.push(new vscode.Diagnostic(new vscode.Range(startPos, endPos), `O método "${methodName}" deve conter pelo menos um return.`, vscode.DiagnosticSeverity.Warning));
        }
    }
    // returnType bool JS/TS (mantido)
    if (rules.returnType === "bool" && (document.languageId === "typescript" || document.languageId === "javascript")) {
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
    // returnRelated: agora tenta inferir semanticamente antes de avisar
    if (rules.returnRelated) {
        const related = isReturnRelated(document, fullText, methodBodyText, paramsString, baseName);
        if (!related) {
            diagnostics.push(new vscode.Diagnostic(new vscode.Range(startPos, endPos), `O método "${methodName}" deve retornar algo relacionado à classe "${className}".`, vscode.DiagnosticSeverity.Warning));
        }
    }
    // error
    if (rules.useError) {
        const hasThrowError = /throw\s+new\s+Error\s*\(/.test(methodBodyText);
        if (!hasThrowError) {
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(startPos, endPos),
                `O método "${methodName}" deve usar Error caso não encontre valor.`,
                vscode.DiagnosticSeverity.Warning
            ));
        }
    }
    // mensagens informativas
    if (rules.throwAll) diagnostics.push(new vscode.Diagnostic(new vscode.Range(startPos, endPos), `Todos os métodos da classe "${className}" devem usar throw para finalizar a aplicação.`, vscode.DiagnosticSeverity.Warning));
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
