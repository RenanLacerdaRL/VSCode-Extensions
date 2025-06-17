const vscode = require('vscode');

let statusBarItem;

function activate(context) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(search) Atualizar Diagnósticos';
  statusBarItem.tooltip = 'Clique para forçar reanálise dos arquivos e atualizar a aba Problems';
  statusBarItem.command = 'projectChecker.refreshDiagnostics';

  context.subscriptions.push(statusBarItem);

  updateStatusBar();

  // Atualiza o botão se mudar o workspace (abrir ou fechar pasta)
  vscode.workspace.onDidChangeWorkspaceFolders(() => {
    updateStatusBar();
  }, null, context.subscriptions);

  const disposable = vscode.commands.registerCommand('projectChecker.refreshDiagnostics', async () => {
    await refreshDiagnosticsForAllFiles();
  });
  context.subscriptions.push(disposable);
}

function updateStatusBar() {
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    statusBarItem.show();
  } else {
    statusBarItem.hide();
  }
}

function deactivate() {
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}

async function openCloseFile(uri) {
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  } catch (e) {
    console.error('Erro ao abrir/fechar arquivo:', uri.fsPath, e);
  }
}

async function refreshDiagnosticsForAllFiles() {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    vscode.window.showInformationMessage('Abra uma pasta de projeto para fazer a verificação.');
    return;
  }

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Atualizando diagnósticos do projeto...',
    cancellable: true
  }, async (progress, token) => {
    const files = await vscode.workspace.findFiles('**/*.{ts,js,jsx,tsx,cs,java,py,html,css,json}', '**/node_modules/**');
    let count = 0;
    const total = files.length;

    for (const file of files) {
      if (token.isCancellationRequested) {
        vscode.window.showInformationMessage('Verificação cancelada pelo usuário.');
        return;
      }

      await openCloseFile(file);
      count++;
      progress.report({ message: `Processados ${count} de ${total} arquivos...`, increment: (1 / total) * 100 });
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
    await vscode.commands.executeCommand('workbench.action.problems.focus');

    vscode.window.showInformationMessage(`Verificação concluída: ${count} arquivos processados.`);
  });
}

module.exports = {
  activate,
  deactivate
};
