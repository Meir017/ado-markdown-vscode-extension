/**
 * Entry point for `@vscode/test-electron`. Downloads (cached) a VS Code build,
 * launches it with our extension as `--extensionDevelopmentPath`, and runs the
 * Mocha suite from `./suite/index.js` inside the extension host.
 *
 * Run via `npm run test:integration`.
 */
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');

  // The integration suite expects an Azure DevOps repo to be open so that
  // AdoWorkspaceContext can detect an org from the git remote. We default to
  // a known local clone but allow override via env so the test can run on
  // any machine that has a different ADO checkout.
  const workspaceFolder =
    process.env.ADO_MARKDOWN_TEST_WORKSPACE ??
    'D:\\ai\\repos\\microsoft\\WDATP\\WDATP.Infra.System.KPIHelper';

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      version: 'stable',
      launchArgs: [
        workspaceFolder,
        // Disable any other extensions so they cannot interfere with the
        // markdown rendering pipeline. `vscode.git` is built in and stays.
        '--disable-extensions',
      ],
      extensionTestsEnv: {
        ADO_MARKDOWN_TEST_WORKSPACE: workspaceFolder,
      },
    });
  } catch (err) {
    console.error('Integration tests failed', err);
    process.exit(1);
  }
}

void main();
