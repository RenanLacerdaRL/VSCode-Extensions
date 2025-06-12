const vscode = require('vscode');

let diagnosticsCollection;
let statusBarItem;

function activate(context) {
    diagnosticsCollection = vscode.languages.createDiagnosticCollection('unusedSymbols');

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(search) Variáveis e métodos não usados';
    statusBarItem.tooltip = 'Clique para verificar variáveis e métodos não utilizados no projeto (públicas e privadas)';
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

    // Lista de métodos ignorados (Unity, colisão, ciclo de vida etc)
    const ignoredMethods = new Set([
        'OnTriggerEnter','OnTriggerExit','OnTriggerStay',
        'OnCollisionEnter','OnCollisionExit','OnCollisionStay',
        'OnControllerColliderHit','OnParticleCollision',
        'Awake','Start','Update','FixedUpdate','LateUpdate',
        'OnEnable','OnDisable','OnDestroy',
    ]);

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Verificando métodos e variáveis não usadas no projeto...',
        cancellable: false
    }, async (progress) => {

        const files = await vscode.workspace.findFiles(
            '**/*.{ts,js,html,cs}',
            '{**/node_modules/**,**/[Cc]ore/**}'
        );

        const docs = await Promise.all(files.map(f => vscode.workspace.openTextDocument(f)));

        const declaredSymbols = new Map();
        const allDeclared = [];

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
                /\[SerializeField\]\s+\w+\s+(\w+)\s*;/g
            ],
        };

        const varRegexes = {
            ts: [
                /\b(?:public|private)?\s*(?:readonly\s+)?(\w+)\s*[:=]/g,
                /(?:\bconst\s+|\blet\s+|\bvar\s+)(\w+)\s*[:=]/g
            ],
            js: /(?:\bconst\s+|\blet\s+|\bvar\s+)(\w+)\s*=/g,
            cs: [
                /\b(?:public|private)?\s*(?:static\s+)?\w+\s+(\w+)\s*(?:=|;)/g,
                /\[SerializeField\]\s+\w+\s+(\w+)\s*;/g
            ],
        };

        function extractSymbols(text, regexes) {
            const symbols = [];
            for (const regex of Array.isArray(regexes) ? regexes : [regexes]) {
                let m;
                while ((m = regex.exec(text)) !== null) {
                    if (m[1]) symbols.push(m[1]);
                }
            }
            return symbols;
        }

        for (const doc of docs) {
            const lang = doc.languageId;
            let text = doc.getText();

            // Ignorar linhas 'using' em C#
            if (lang === 'csharp') {
                const lines = text.split('\n').filter(line => !line.trim().startsWith('using '));
                text = lines.join('\n');
            }

            let methods = [], vars = [];
            if (lang.startsWith('typescript')) {
                methods = extractSymbols(text, methodRegexes.ts);
                vars    = extractSymbols(text, varRegexes.ts);
            } else if (lang.startsWith('javascript')) {
                methods = extractSymbols(text, methodRegexes.js);
                vars    = extractSymbols(text, varRegexes.js);
            } else if (lang === 'csharp') {
                methods = extractSymbols(text, methodRegexes.cs);
                vars    = extractSymbols(text, varRegexes.cs);
            }

            const symbols = methods.concat(vars);
            declaredSymbols.set(doc.uri.toString(), symbols);
            symbols.forEach(name => allDeclared.push({ name, uri: doc.uri, doc }));
        }

        const projectText = docs.map(d => d.getText()).join('\n');
        const diagnosticsByUri = new Map();

        for (const { name, uri, doc } of allDeclared) {
            if (ignoredMethods.has(name)) continue;

            const docText = doc.getText();
            const usageRegex = new RegExp(`\\b${name}\\b`, 'g');
            let allMatches = [...projectText.matchAll(usageRegex)];

            // Ignorar ocorrências em linhas using e em estruturas de objeto (ex: { key: value })
            allMatches = allMatches.filter(match => {
                const idx = match.index;
                const start = projectText.lastIndexOf('\n', idx) + 1;
                const end = projectText.indexOf('\n', idx);
                const ln = projectText.substring(start, end !== -1 ? end : projectText.length);

                return !/^\s*using\s+/.test(ln) &&
                       !/\{\s*[^:]*:\s*[^}]*\b${name}\b[^}]*\}/.test(ln);
            });

            if (allMatches.length <= 1) {
                const idx = docText.indexOf(name);
                if (idx !== -1) {
                    const pos   = doc.positionAt(idx);
                    const range = new vscode.Range(pos, pos.translate(0, name.length));
                    const list  = diagnosticsByUri.get(uri.toString()) || [];
                    list.push(new vscode.Diagnostic(
                        range,
                        `O símbolo "${name}" parece não estar sendo utilizado em lugar algum no projeto.`,
                        vscode.DiagnosticSeverity.Warning
                    ));
                    diagnosticsByUri.set(uri.toString(), list);
                }
            }
        }

        diagnosticsByUri.forEach((diags, uriStr) => {
            diagnosticsCollection.set(vscode.Uri.parse(uriStr), diags);
        });

        vscode.window.showInformationMessage(
            `Verificação concluída. Encontrados ${Array.from(diagnosticsByUri.values()).flat().length} símbolos possivelmente não utilizados.`
        );
    });
}

module.exports = { activate, deactivate };
