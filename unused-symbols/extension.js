const vscode = require('vscode');

let diagnosticsCollection;
let statusBarItem;

function activate(context) {
    diagnosticsCollection = vscode.languages.createDiagnosticCollection('unusedMethods');

    // Botão na status bar
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(search) Verificar métodos não usados';
    statusBarItem.tooltip = 'Clique para verificar métodos não utilizados no arquivo atual';
    statusBarItem.command = 'unusedMethods.checkCurrentFile';
    statusBarItem.show();

    context.subscriptions.push(
        vscode.commands.registerCommand('unusedMethods.checkCurrentFile', checkCurrentFile),
        diagnosticsCollection,
        statusBarItem
    );
}

function deactivate() {
    diagnosticsCollection?.dispose();
    statusBarItem?.dispose();
}

async function checkCurrentFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showInformationMessage('Nenhum editor ativo.');
        return;
    }

    const doc = editor.document;
    if (!['typescript','javascript','csharp'].includes(doc.languageId)) {
        vscode.window.showInformationMessage('Arquivo não suportado. Use TS, JS ou C#.');
        return;
    }

    diagnosticsCollection.clear();

    const text = doc.getText();
    const methods = findMethodsInText(text, doc.languageId);
    const diagnostics = [];

    for (const m of methods) {
        if (isSpecialMethod(m.name)) continue;

        const pos = doc.positionAt(m.index);
        // Pede ao próprio VSCode/OmniSharp todas as referências (inclui declaração)
        const refs = await vscode.commands.executeCommand(
            'vscode.executeReferenceProvider',
            doc.uri,
            pos
        );
        const total = Array.isArray(refs) ? refs.length : 0;

        // Se só houver a própria declaração, marca como não usado
        if (total <= 1) {
            const range = new vscode.Range(
                pos,
                doc.positionAt(m.index + m.name.length)
            );
            diagnostics.push(new vscode.Diagnostic(
                range,
                `Método "${m.name}" não parece ser usado.`,
                vscode.DiagnosticSeverity.Warning
            ));
        }
    }

    diagnosticsCollection.set(doc.uri, diagnostics);
    vscode.window.showInformationMessage(
        `Verificação concluída: ${diagnostics.length} método(s) não utilizado(s).`
    );
}

function findMethodsInText(text, languageId) {
    const methods = [];

    if (languageId === 'csharp') {
        const re = /\b(?:public|private|protected|internal)?\s*(?:static\s+)?(?:readonly\s+)?(?:void|\w+)\s+(\w+)\s*\([^)]*\)\s*\{/g;
        let m;
        while ((m = re.exec(text)) !== null) {
            methods.push({ name: m[1], index: m.index + m[0].indexOf(m[1]) });
        }
    } else {
        const regexes = [
            /function\s+(\w+)\s*\([^)]*\)\s*\{/g,
            /(?:\bconst\s+|\blet\s+|\bvar\s+)(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g,
            /(?:\bconst\s+|\blet\s+|\bvar\s+)(\w+)\s*=\s*function\s*\([^)]*\)/g
        ];
        for (const re of regexes) {
            let m;
            while ((m = re.exec(text)) !== null) {
                methods.push({ name: m[1], index: m.index + m[0].indexOf(m[1]) });
            }
        }
    }

    return methods;
}

function isSpecialMethod(name) {
    return [
        '.ctor', '.cctor', 'Awake', 'Start', 'Update', 'FixedUpdate',
        'LateUpdate','OnEnable','OnDisable','OnDestroy',
        'OnTriggerEnter','OnTriggerExit','OnTriggerStay',
        'OnCollisionEnter','OnCollisionExit','OnCollisionStay'
    ].includes(name);
}

module.exports = { activate, deactivate };
