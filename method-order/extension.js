const vscode = require('vscode');

let diagnosticsCollection;

// Prefix order for uncalled methods
const prefixOrder = [
  'constructor','ngOnInit','Awake','Create','Start','Setup','Patch','Initialize','Tick',
  'Get','Load','Set','Post','Save','Put','Update','Is','Exists','Approve','Valid','Invalid',
  '__ANY__','Min','Max','Enable','Disable','Show','Hide','Success','Notification','Information',
  'Warning','Error','Dismiss','Remove','Close','Delete','Destroy','Reset','On','Subscriber'
];

function activate(context) {
  diagnosticsCollection = vscode.languages.createDiagnosticCollection('methodOrder');

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
  const tsLangs = ['typescript','typescriptreact','javascript','javascriptreact'];
  const isTS = tsLangs.includes(document.languageId);
  const isCS = document.languageId === 'csharp';
  if (!isTS && !isCS) {
    diagnosticsCollection.delete(document.uri);
    return;
  }

  const text = document.getText();
  const diagnostics = [];

  // 1) Captura todos os métodos definidos na classe
  // C#: mantemos o regex existente
  const csMethodRegex = /((public|protected|internal|private)\s+)?(static\s+)?(?:void|\w+)\s+(\w+)\s*\([^)]*\)\s*\{/g;
  // TS/JS: opcional public/private, async, static, nome e possível tipo de retorno
  const tsMethodRegex = /^\s*(?:public|protected|private)?\s*(?:static\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[\w<>\[\]\|\s,]*)?\s*\{/gm;

  const methods = [];
  let match;
  const regex = isCS ? csMethodRegex : tsMethodRegex;

  while ((match = regex.exec(text)) !== null) {
    const name = isCS ? match[4] : match[1];
    methods.push({ name, start: match.index });
  }
  const definedOrder = methods.map(m => m.name);

  // 2) Constroi o mapa de chamadas e identifica o primeiro caller
  const callMap = new Map();
  const firstCaller = {};

  for (let i = 0; i < methods.length; i++) {
    const m = methods[i];
    // extrai corpo do método
    const bodyStart = text.indexOf('{', m.start);
    let braceCount = 1, j = bodyStart + 1;
    while (j < text.length && braceCount > 0) {
      if (text[j] === '{') braceCount++;
      else if (text[j] === '}') braceCount--;
      j++;
    }
    const body = text.slice(bodyStart + 1, j - 1);

    const calls = [];
    const callRegex = /\b(\w+)\s*\(/g;
    let cm;
    while ((cm = callRegex.exec(body)) !== null) {
      const callee = cm[1];
      if (definedOrder.includes(callee) && callee !== m.name) {
        calls.push(callee);
        if (firstCaller[callee] === undefined) {
          firstCaller[callee] = i;
        }
      }
    }

    callMap.set(m.name, calls);
  }

  // 3) Enforce call-order apenas para o firstCaller de cada callee
  for (const [caller, calls] of callMap.entries()) {
    if (!calls.length) continue;
    const callerIdx = definedOrder.indexOf(caller);
    for (let k = 0; k < calls.length; k++) {
      const callee = calls[k];
      if (firstCaller[callee] !== callerIdx) continue;
      const expected = callee;
      const actual = definedOrder[callerIdx + 1 + k];
      if (actual !== expected) {
        const calleeMethod = methods.find(x => x.name === expected);
        const pos = document.positionAt(calleeMethod.start);
        const range = new vscode.Range(pos, pos.translate(0, expected.length));
        diagnostics.push(new vscode.Diagnostic(
          range,
          `O Método "${expected}" precisa estar abaixo de "${caller}" como chamada ${k + 1}.`,
          vscode.DiagnosticSeverity.Warning
        ));
      }
    }
  }

  // 4) Enforce prefix-order + ordenação alfabética dentro de cada grupo para métodos não chamados
  const allCalled = new Set([].concat(...Array.from(callMap.values())));
  const uncalled = methods.filter(x => !allCalled.has(x.name));
  const uncalledInCode = uncalled.slice().sort((a, b) => a.start - b.start);

  const anyIdx = prefixOrder.indexOf('__ANY__');
  const withIndex = uncalledInCode.map(x => {
    let prefixIdx = prefixOrder.findIndex(p => x.name.startsWith(p));
    if (prefixIdx === -1) prefixIdx = anyIdx;
    return { name: x.name, start: x.start, prefixIdx, suffix: x.name.toLowerCase() };
  });

  for (let i = 0; i < withIndex.length - 1; i++) {
    const curr = withIndex[i];
    const next = withIndex[i + 1];
    if (
      curr.prefixIdx > next.prefixIdx ||
      (curr.prefixIdx === next.prefixIdx && curr.suffix > next.suffix)
    ) {
      const pos = document.positionAt(next.start);
      const range = new vscode.Range(pos, pos.translate(0, next.name.length));
      diagnostics.push(new vscode.Diagnostic(
        range,
        `O método "${next.name}" precisa estar acima de "${curr.name}".`,
        vscode.DiagnosticSeverity.Warning
      ));
    }
  }

  diagnosticsCollection.set(document.uri, diagnostics);
}

module.exports = { activate, deactivate };
