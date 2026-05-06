/**
 * Integration tests that exercise the extension end-to-end inside a real
 * VS Code instance via @vscode/test-electron.
 *
 * The host is launched against a known Azure DevOps git repo (see runTest.ts)
 * so that `AdoWorkspaceContext` can detect an org from the git remote. We then:
 *   1. Activate the extension and capture its exported `extendMarkdownIt`.
 *   2. Build a fresh `markdown-it` instance, run our plugin through it, and
 *      render the same `!N` reference that lives in the target ADR file.
 *   3. Assert the rendered HTML carries our `ado-ref` markup with the right
 *      `data-ado-id` — i.e. the plugin actually fired in this workspace.
 *   4. Open the ADR file and the side preview to make sure no errors are
 *      thrown during real preview rendering.
 *
 * We deliberately do NOT scrape the webview DOM. The webview is a sandboxed
 * iframe whose contents are not reachable from the extension host. Asserting
 * on `extendMarkdownIt` output gives us the same signal: if our plugin emits
 * the right HTML for the markdown the preview is rendering, the preview will
 * show it.
 */
import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';

const EXTENSION_ID = 'meblachm.ado-markdown';
const EXPECTED_PR_ID = '9918141';

interface ExtensionApi {
  extendMarkdownIt(md: MarkdownIt): MarkdownIt;
}

async function getExtensionApi(): Promise<ExtensionApi> {
  const ext = vscode.extensions.getExtension<ExtensionApi>(EXTENSION_ID);
  assert.ok(ext, `Extension ${EXTENSION_ID} not found in dev host`);
  const api = await ext.activate();
  assert.ok(
    typeof api.extendMarkdownIt === 'function',
    'Extension did not export extendMarkdownIt',
  );
  return api;
}

suite('ADO Markdown — VS Code integration', () => {
  test('opens the configured workspace folder', () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    assert.ok(folders.length > 0, 'No workspace folder was opened');
  });

  test('the built-in vscode.git extension is available', () => {
    const gitExt = vscode.extensions.getExtension('vscode.git');
    assert.ok(gitExt, 'vscode.git extension is unavailable');
  });

  test('extension activates and exports extendMarkdownIt', async () => {
    const api = await getExtensionApi();
    const md = new MarkdownIt();
    const extended = api.extendMarkdownIt(md);
    assert.strictEqual(extended, md, 'extendMarkdownIt should return the same instance');
  });

  test(`renders !${EXPECTED_PR_ID} as an ado-ref placeholder`, async function () {
    this.timeout(20_000);
    const api = await getExtensionApi();
    const md = api.extendMarkdownIt(new MarkdownIt());

    // Give AdoWorkspaceContext time to subscribe to vscode.git and pick up the
    // remote. The git extension activates lazily on workspace open.
    await waitFor(
      () => /ado-ref/.test(md.render(`!${EXPECTED_PR_ID}`)),
      10_000,
      `plugin never emitted ado-ref markup for !${EXPECTED_PR_ID}`,
    );

    const html = md.render(`See !${EXPECTED_PR_ID} for context.`);
    assert.match(html, /class="[^"]*\bado-ref\b[^"]*"/, 'expected ado-ref class on output');
    assert.match(
      html,
      new RegExp(`data-ado-id="${EXPECTED_PR_ID}"`),
      'expected data-ado-id to carry the PR id',
    );
    assert.match(html, /data-ado-kind="pullRequest"/, 'expected data-ado-kind=pullRequest');
  });

  test('renders #N as an ado-ref work item placeholder', async () => {
    const api = await getExtensionApi();
    const md = api.extendMarkdownIt(new MarkdownIt());

    const html = md.render('Tracking work item #42 here.');

    assert.match(html, /class="[^"]*\bado-ref\b[^"]*"/);
    assert.match(html, /data-ado-id="42"/);
    assert.match(html, /data-ado-kind="workItem"/);
  });

  test('does not transform plain markdown without ADO refs', async () => {
    const api = await getExtensionApi();
    const md = api.extendMarkdownIt(new MarkdownIt());

    const html = md.render('Just a [normal](https://example.com) link.');
    assert.doesNotMatch(html, /ado-ref/);
  });

  test('opens the ADR file and the side preview without errors', async function () {
    this.timeout(45_000);

    const folders = vscode.workspace.workspaceFolders ?? [];
    assert.ok(folders.length > 0);
    const workspaceRoot = folders[0]!.uri.fsPath;

    const relativeMd =
      process.env.ADO_MARKDOWN_TEST_FILE ??
      path.join('docs', 'adr', '0001-collect-sharedcharts-usage-from-user-workloads.md');
    const fileUri = vscode.Uri.file(path.join(workspaceRoot, relativeMd));

    const doc = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(doc);

    await vscode.commands.executeCommand('markdown.showPreviewToSide', fileUri);
    await new Promise((r) => setTimeout(r, 3000));

    // Reaching here without throwing is the assertion. Any rendering crash
    // in our plugin would surface as an exception in markdown-it.
  });
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!predicate()) {
    throw new Error(`Timed out after ${timeoutMs}ms: ${message}`);
  }
}
