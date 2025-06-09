const vscode = require('vscode');

let diagnosticsCollection;

function activate(context) {
    diagnosticsCollection = vscode.languages.createDiagnosticCollection('arrayNamePlural');

    if (vscode.window.activeTextEditor) {
        updateDiagnostics(vscode.window.activeTextEditor.document);
    }

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) updateDiagnostics(editor.document);
        }),
        vscode.workspace.onDidChangeTextDocument(e => {
            updateDiagnostics(e.document);
        }),
        diagnosticsCollection
    );
}

function deactivate() {
    if (diagnosticsCollection) {
        diagnosticsCollection.dispose();
    }
}

function updateDiagnostics(document) {
    const langs = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'csharp'];

    if (!langs.includes(document.languageId)) {
        diagnosticsCollection.delete(document.uri);
        return;
    }

    const diagnostics = [];
    const text = document.getText();

    // helper interno para adicionar diagnostic
    function addDiagnostic(varName, idx) {
        const startPos = document.positionAt(idx);
        const endPos = document.positionAt(idx + varName.length);
        const range = new vscode.Range(startPos, endPos);

        diagnostics.push(new vscode.Diagnostic(
            range,
            `Variável "${varName}" é um array e deve ter nome no plural (terminar com "s").`,
            vscode.DiagnosticSeverity.Warning
        ));
    }

    if (document.languageId.startsWith('typescript') || document.languageId.startsWith('javascript')) {
        // 1) Locais: const|let|var com array literal ou Array<> tipado
        const tsPattern = /^\s*(?:const|let|var)\s+(\w+)\s*(?::\s*([^=;]+))?\s*=\s*(?:\[|new\s+Array<)/gm;
        let match;
        while ((match = tsPattern.exec(text)) !== null) {
            const varName = match[1];
            if (!varName.endsWith('s')) {
                const idx = match.index + match[0].indexOf(varName);
                addDiagnostic(varName, idx);
            }
        }

        // 2) Campos de classe tipados: por exemplo, private popupAction: PoPopupAction[] = [];
        const classFieldPattern = /^\s*(?:public|protected|private)?\s*(?:readonly\s*)?(\w+)\s*:\s*[\w<>\[\]]+\[\]\s*=/gm;
        while ((match = classFieldPattern.exec(text)) !== null) {
            const varName = match[1];
            if (!varName.endsWith('s')) {
                const idx = match.index + match[0].indexOf(varName);
                addDiagnostic(varName, idx);
            }
        }

    } else if (document.languageId === 'csharp') {
        // C#: detecção unificada de arrays e coleções genéricas em campos e var
        const csPatterns = [
            // T[] name;
            /\b[\w<>\.]+\s*\[\]\s+(\w+)\b/g,
            // List<...> name; IList<...> etc.
            /\b(?:List|IList|IEnumerable|Collection)<[^>]+>\s+(\w+)\b/g,
            // var name = new T[...] or new List<...>();
            /\bvar\s+(\w+)\s*=\s*new\s+[\w<>\.\[\]]+\s*(?:\(|\[)/g
        ];

        for (const pattern of csPatterns) {
            let m;

            while ((m = pattern.exec(text)) !== null) {
                const varName = m[1];

                if (!varName.endsWith('s')) {
                    const idx = m.index + m[0].indexOf(varName);

                    addDiagnostic(varName, idx);
                }
            }
        }
    }

    diagnosticsCollection.set(document.uri, diagnostics);
}

module.exports = {
    activate,
    deactivate
};
