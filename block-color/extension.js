const vscode = require('vscode');

let decorationTypes = [];

function getConfig() {
    const cfg = vscode.workspace.getConfiguration('rl.block-color');
    return {
        showBackground: cfg.get('showBackground', false),
        showBorder:     cfg.get('showBorder', true),
        defaultColor:   cfg.get('defaultColor', '#cccccc')
    };
}

function activate(context) {
    if (vscode.window.activeTextEditor) {
        updateDecorations(vscode.window.activeTextEditor);
    }
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) updateDecorations(editor);
        }),
        vscode.workspace.onDidChangeTextDocument(e => {
            if (vscode.window.activeTextEditor && e.document === e.document) {
                updateDecorations(vscode.window.activeTextEditor);
            }
        }),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (
                e.affectsConfiguration('rl.block-color.showBackground') ||
                e.affectsConfiguration('rl.block-color.showBorder') ||
                e.affectsConfiguration('rl.block-color.defaultColor')
            ) {
                if (vscode.window.activeTextEditor) {
                    updateDecorations(vscode.window.activeTextEditor);
                }
            }
        })
    );
}

function deactivate() {
    decorationTypes.forEach(d => d.dispose());
    decorationTypes = [];
}

function createTopDecoration(color, showBg, showBorder) {
    return vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        ...(showBorder && {
            borderWidth: '2px 2px 0 2px',
            borderStyle: 'solid',
            borderColor: color,
            borderRadius: '4px 4px 0 0'
        }),
        ...(showBg && {
            backgroundColor: color + '10'
        })
    });
}

function createMiddleDecoration(color, showBg, showBorder) {
    return vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        ...(showBorder && {
            borderWidth: '0 2px 0 2px',
            borderStyle: 'solid',
            borderColor: color
        }),
        ...(showBg && {
            backgroundColor: color + '10'
        })
    });
}

function createBottomDecoration(color, showBg, showBorder) {
    return vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        ...(showBorder && {
            borderWidth: '0 2px 2px 2px',
            borderStyle: 'solid',
            borderColor: color,
            borderRadius: '0 0 4px 4px'
        }),
        ...(showBg && {
            backgroundColor: color + '10'
        })
    });
}

function updateDecorations(editor) {
    const { showBackground, showBorder, defaultColor } = getConfig();
    const doc = editor.document;
    const lines = doc.getText().split(/\r?\n/);

    // limpa decorações antigas
    decorationTypes.forEach(d => d.dispose());
    decorationTypes = [];

// Comentário com HEX entre chaves, ex: {#123456}
const reHex = /^(\s*)\/\/.*?\{\s*(#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}))\s*\}/;

// Comentário com palavra após # colada (ex: #Post → cor padrão)
const reDefault = /^(\s*)\/\/.*?#([A-Z][\w]*)\b/;

    // coleta comentários com cor ou vazio
    const starts = [];
lines.forEach((ln, idx) => {
    const mHex = reHex.exec(ln);
    const mDefault = reDefault.exec(ln);

    if (mHex) {
        starts.push({ line: idx, color: mHex[2] }); // mHex[2] já é #hex
    } else if (mDefault) {
        starts.push({ line: idx, color: defaultColor });
    }
});

    // para cada bloco
    for (let k = 0; k < starts.length; k++) {
        const { line: startLine, color } = starts[k];
        const endLine = (k + 1 < starts.length)
            ? starts[k + 1].line - 1
            : lines.length - 1;
        if (endLine < startLine) continue;

        // cria decorações
        const topDeco = createTopDecoration(color, showBackground, showBorder);
        const midDeco = createMiddleDecoration(color, showBackground, showBorder);
        const botDeco = createBottomDecoration(color, showBackground, showBorder);
        decorationTypes.push(topDeco, midDeco, botDeco);

        // aplica na linha de topo
        editor.setDecorations(
            topDeco,
            [new vscode.Range(startLine, 0, startLine, lines[startLine].length)]
        );

        // aplica nas linhas do meio
        if (endLine > startLine + 1) {
            const midRanges = [];
            for (let i = startLine + 1; i < endLine; i++) {
                midRanges.push(new vscode.Range(i, 0, i, lines[i].length));
            }
            editor.setDecorations(midDeco, midRanges);
        }

        // aplica na linha de base
        if (endLine > startLine) {
            editor.setDecorations(
                botDeco,
                [new vscode.Range(endLine, 0, endLine, lines[endLine].length)]
            );
        }
    }
}

module.exports = { activate, deactivate };
