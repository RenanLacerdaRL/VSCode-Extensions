const vscode = require('vscode');

let diagnosticsCollection;
let statusBarItem;

function activate(context) {
    diagnosticsCollection = vscode.languages.createDiagnosticCollection('unusedSymbols');

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(search) Verificar métodos e variáveis não usados';
    statusBarItem.tooltip = 'Clique para verificar métodos e variáveis não utilizadas no projeto (públicas e privadas)';
    statusBarItem.command = 'unusedSymbols.checkUnused';
    statusBarItem.show();

    context.subscriptions.push(statusBarItem);

    const disposable = vscode.commands.registerCommand('unusedSymbols.checkUnused', async () => {
        if (!vscode.workspace.workspaceFolders) {
            vscode.window.showInformationMessage('Abra uma pasta de projeto para fazer a verificação.');
            return;
        }

        await checkUnusedSymbols();
    });

    context.subscriptions.push(disposable);
}

function deactivate() {
    if (diagnosticsCollection) diagnosticsCollection.dispose();
    if (statusBarItem) statusBarItem.dispose();
}

async function checkUnusedSymbols() {
    diagnosticsCollection.clear();

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Verificando métodos e variáveis não usadas no projeto...',
        cancellable: false
    }, async (progress) => {

        // Buscar todos arquivos relevantes
        const files = await vscode.workspace.findFiles('**/*.{ts,js,html,cs}', '**/node_modules/**');

        // Abrir todos documentos (texto)
        const docs = await Promise.all(files.map(f => vscode.workspace.openTextDocument(f)));

        // Map: chave = arquivo.uri, valor = lista de símbolos (metodos/vars) declarados nesse arquivo
        const declaredSymbols = new Map();

        // Lista global de todos nomes declarados (com infos de onde está)
        const allDeclared = [];

        // Regex atualizado para incluir métodos sem especificador de acesso
        const methodRegexes = {
            ts: [
                /\b(?:public|private)?\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/g,
                /(?:\bconst\s+|\blet\s+|\bvar\s+)(\w+)\s*=\s*(?:async\s+)?\s*\([^)]*\)\s*=>/g,
                /(?:\bconst\s+|\blet\s+|\bvar\s+)(\w+)\s*=\s*function\s*\([^)]*\)/g
            ],
            js: [
                /function\s+(\w+)\s*\([^)]*\)\s*\{/g,
                /(?:\bconst\s+|\blet\s+|\bvar\s+)(\w+)\s*=\s*(?:async\s+)?\s*\([^)]*\)\s*=>/g,
                /(?:\bconst\s+|\blet\s+|\bvar\s+)(\w+)\s*=\s*function\s*\([^)]*\)/g
            ],
            cs: [
                /\b(?:public|private)?\s*(?:static\s+)?(?:void|\w+)\s+(\w+)\s*\([^)]*\)\s*\{/g,
                /\[SerializeField\]\s+\w+\s+(\w+)\s*;/g  // Regex específico para campos serializados
            ],
        };

        // Regex atualizado para incluir variáveis sem especificador de acesso
        const varRegexes = {
            ts: [
                /\b(?:public|private)?\s*(?:readonly\s+)?(\w+)\s*[:=]/g,
                /(?:\bconst\s+|\blet\s+|\bvar\s+)(\w+)\s*[:=]/g
            ],
            js: /(?:\bconst\s+|\blet\s+|\bvar\s+)(\w+)\s*=/g,
            cs: [
                /\b(?:public|private)?\s*(?:static\s+)?\w+\s+(\w+)\s*(?:=|;)/g,
                /\[SerializeField\]\s+\w+\s+(\w+)\s*;/g  // Regex específico para campos serializados
            ],
        };

        // Função auxiliar para extrair símbolos de texto por regex
        function extractSymbols(text, regexes, lang) {
            const symbols = [];
            for (const regex of Array.isArray(regexes) ? regexes : [regexes]) {
                let m;
                while ((m = regex.exec(text)) !== null) {
                    if (m[1]) symbols.push(m[1]);
                }
            }
            return symbols;
        }

        // 1. Extrair todos símbolos declarados
        for (const doc of docs) {
            const lang = doc.languageId;
            const text = doc.getText();

            let methods = [];
            let vars = [];

            if (lang === 'typescript' || lang === 'typescriptreact') {
                methods = extractSymbols(text, methodRegexes.ts, lang);
                vars = extractSymbols(text, varRegexes.ts, lang);
            } else if (lang === 'javascript' || lang === 'javascriptreact') {
                methods = extractSymbols(text, methodRegexes.js, lang);
                vars = extractSymbols(text, varRegexes.js, lang);
            } else if (lang === 'csharp') {
                methods = extractSymbols(text, methodRegexes.cs, lang);
                vars = extractSymbols(text, varRegexes.cs, lang);
            } else if (lang === 'html') {
                methods = [];
                vars = [];
            }

            const symbols = methods.concat(vars);
            declaredSymbols.set(doc.uri.toString(), symbols);

            for (const sym of symbols) {
                allDeclared.push({ name: sym, uri: doc.uri, lang, doc });
            }
        }

        // 2. Construir um texto único de todo projeto para busca das referências
        const projectText = docs.map(d => d.getText()).join('\n');

        // 3. Para cada símbolo declarado, procurar se é usado no projeto (exceto onde declarado)
        const diagnosticsByUri = new Map();

        for (const symInfo of allDeclared) {
            const { name, uri, doc } = symInfo;
            const text = doc.getText();

            // Verificar se o símbolo está em uma linha com throw
            const symbolPosition = text.indexOf(name);
            if (symbolPosition !== -1) {
                const lineStart = text.lastIndexOf('\n', symbolPosition) + 1;
                const lineEnd = text.indexOf('\n', symbolPosition);
                const line = text.substring(lineStart, lineEnd !== -1 ? lineEnd : text.length);

                if (line.includes('throw')) {
                    continue; // Ignora símbolos em linhas com throw
                }
            }

            // Regex que procura uso: \bname\b (para capturar tanto métodos quanto variáveis)
            const usageRegex = new RegExp(`\\b${name}\\b`, 'g');

            // Contar quantas vezes aparece
            const allMatches = [...projectText.matchAll(usageRegex)];
            // Se só existe na declaração (pelo menos 1)
            // Vamos considerar só 1 (a declaração), se tiver só uma ocorrência, não usado
            if (allMatches.length <= 1) {
                // Marca warning nesse arquivo na primeira ocorrência da declaração
                const idx = text.indexOf(name);
                if (idx !== -1) {
                    const pos = doc.positionAt(idx);
                    const range = new vscode.Range(pos, pos.translate(0, name.length));

                    if (!diagnosticsByUri.has(uri.toString())) {
                        diagnosticsByUri.set(uri.toString(), []);
                    }
                    diagnosticsByUri.get(uri.toString()).push(
                        new vscode.Diagnostic(
                            range,
                            `O símbolo "${name}" parece não estar sendo utilizado em lugar algum no projeto.`,
                            vscode.DiagnosticSeverity.Warning
                        )
                    );
                }
            }
        }

        // 4. Atualizar diagnostics
        diagnosticsByUri.forEach((diags, uriStr) => {
            const uri = vscode.Uri.parse(uriStr);
            diagnosticsCollection.set(uri, diags);
        });

        vscode.window.showInformationMessage(`Verificação concluída. Encontrados ${Array.from(diagnosticsByUri.values()).flat().length} símbolos possivelmente não utilizados.`);
    });
}

module.exports = { activate, deactivate };
