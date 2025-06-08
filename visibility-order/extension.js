const vscode = require("vscode");

function activate(context) {
  const diagnosticCollection = vscode.languages.createDiagnosticCollection("visibilidadeOrdem");

  vscode.workspace.onDidSaveTextDocument(document => {
    if (!["typescript", "typescriptreact", "javascript", "javascriptreact", "csharp"].includes(document.languageId)) {
      return;
    }

    const diagnostics = [];
    const text = document.getText();

    const regexClasse = /class\s+\w+[\s\S]*?{([\s\S]*?)}/g;
    const regexMembro = /(?:\[.*?\]\s*)*(public|protected|internal|private)?\s*(?:\w[\w\s<>]*?\s+)?\w+\s*(?:\(|=|{)/g;

    for (const matchClasse of text.matchAll(regexClasse)) {
      const corpoClasse = matchClasse[1];
      const membros = [];

      for (const matchMembro of corpoClasse.matchAll(regexMembro)) {
        const visibilidade = matchMembro[1] || "default";
        const index = visibilidadeIndex(visibilidade);
        const start = matchMembro.index + matchClasse.index + matchClasse[0].indexOf(corpoClasse);
        const linha = document.positionAt(start).line;

        membros.push({ visibilidade, index, linha });
      }

      let lastIndex = -1;
      for (const membro of membros) {
        if (membro.index < lastIndex) {
          diagnostics.push(new vscode.Diagnostic(
            new vscode.Range(membro.linha, 0, membro.linha, 100),
            `Membro com visibilidade "${membro.visibilidade}" está fora de ordem.`,
            vscode.DiagnosticSeverity.Warning
          ));
          break;
        }
        lastIndex = membro.index;
      }
    }

    diagnosticCollection.set(document.uri, diagnostics);
  });
}

function visibilidadeIndex(vis) {
  switch (vis) {
    case "public": return 0;
    case "protected": return 1;
    case "internal": return 2;
    case "private": return 3;
    case "default": return 3; // assumido como private
    default: return 4;
  }
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
