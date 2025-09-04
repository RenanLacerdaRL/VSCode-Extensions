const vscode = require('vscode');

let decorations = [];

function activate(context) {
    if (vscode.window.activeTextEditor) {
        updateClassDecorations(vscode.window.activeTextEditor);
    }

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) updateClassDecorations(editor);
        }),
        vscode.workspace.onDidChangeTextDocument(e => {
            if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
                updateClassDecorations(vscode.window.activeTextEditor);
            }
        }),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('classIcon')) {
                if (vscode.window.activeTextEditor) {
                    updateClassDecorations(vscode.window.activeTextEditor);
                }
            }
        })
    );
}

function deactivate() {
    decorations.forEach(d => d.dispose());
}

// Atualiza decorações
function updateClassDecorations(editor) {
    const config = vscode.workspace.getConfiguration('classIcon');
    const classList = config.get('classInfo', [
        ["Formatter", "Classe responsável por formatar valores.\nPode conter métodos To*."],
        ["Configuration", "Classe de configuração de parâmetros.\nTodos os métodos devem ser returns."],
        ["Builder", "Classe que constrói objetos complexos."],
        ["Url", "Classe que representa URLs ou endpoints."]
    ]);
    const packageName = config.get('packageName', 'MeuPacote');
    const symbol = config.get('symbol', '*');   // símbolo padrão
    const color = config.get('color', '#FFD700'); // cor padrão

    const text = editor.document.getText();
    const classRegex = /\b(?:export\s+)?class\s+([A-Za-z_]\w*)\b/g;

    // Limpa decorações antigas
    decorations.forEach(d => d.dispose());
    decorations = [];

    const decorationOptions = [];

    let match;
    while ((match = classRegex.exec(text)) !== null) {
        const className = match[1];

        // Procura item cujo primeiro valor seja prefixo da classe
const info = classList.find(item => {
    const prefixes = item[0].split(',').map(p => p.trim());
    return prefixes.some(prefix => className.endsWith(prefix));
});

        const startIndex = match.index + match[0].lastIndexOf(className);
        const endIndex = startIndex + className.length;
        const startPos = editor.document.positionAt(startIndex);
        const endPos = editor.document.positionAt(endIndex);

        // Monta hover
        const hover = new vscode.MarkdownString();

        if (!info) {
            // Cria decoration específica para o símbolo
            const decorationType = vscode.window.createTextEditorDecorationType({
                after: {
                    contentText: '' + symbol,
                    color: color,
                }
            });

            decorationOptions.push({
                range: new vscode.Range(startPos, endPos),
                hoverMessage: hover
            });

            editor.setDecorations(decorationType, decorationOptions);
            decorations.push(decorationType);
        } else {
            // Prefixo cadastrado → apenas hover com a descrição, sem símbolo
            const description = info.slice(1).join(' ').trim();
            const descriptionMd = description.replace(/\r\n/g, '\n').replace(/\n/g, '\n\n');
            if (descriptionMd.length > 0) hover.appendMarkdown(`${descriptionMd}`);

            decorationOptions.push({
                range: new vscode.Range(startPos, endPos),
                hoverMessage: hover
            });
        }
    }

    // Aplica hover para classes cadastradas (sem símbolo)
    const hoverDecorationType = vscode.window.createTextEditorDecorationType({});
    editor.setDecorations(hoverDecorationType, decorationOptions);
    decorations.push(hoverDecorationType);
}

module.exports = { activate, deactivate };
