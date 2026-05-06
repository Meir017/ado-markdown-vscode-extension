import * as assert from 'assert';

import { parseAdoRemote } from '../ado/remote';

describe('parseAdoRemote', () => {
  it('parses https dev.azure.com', () => {
    assert.deepStrictEqual(
      parseAdoRemote('https://dev.azure.com/myorg/myproj/_git/myrepo'),
      { organization: 'myorg', project: 'myproj', repository: 'myrepo' },
    );
  });

  it('parses https dev.azure.com with user prefix and .git suffix', () => {
    assert.deepStrictEqual(
      parseAdoRemote('https://myorg@dev.azure.com/myorg/My%20Proj/_git/repo.git'),
      { organization: 'myorg', project: 'My Proj', repository: 'repo' },
    );
  });

  it('parses legacy visualstudio.com', () => {
    assert.deepStrictEqual(
      parseAdoRemote('https://contoso.visualstudio.com/MyProj/_git/code'),
      { organization: 'contoso', project: 'MyProj', repository: 'code' },
    );
  });

  it('parses legacy visualstudio.com with DefaultCollection', () => {
    assert.deepStrictEqual(
      parseAdoRemote('https://contoso.visualstudio.com/DefaultCollection/MyProj/_git/code'),
      { organization: 'contoso', project: 'MyProj', repository: 'code' },
    );
  });

  it('parses ssh dev.azure.com', () => {
    assert.deepStrictEqual(
      parseAdoRemote('git@ssh.dev.azure.com:v3/myorg/myproj/myrepo'),
      { organization: 'myorg', project: 'myproj', repository: 'myrepo' },
    );
  });

  it('parses ssh visualstudio.com (org-prefixed host)', () => {
    assert.deepStrictEqual(
      parseAdoRemote('contoso@vs-ssh.contoso.visualstudio.com:v3/contoso/MyProj/code'),
      { organization: 'contoso', project: 'MyProj', repository: 'code' },
    );
  });

  it('returns undefined for non-ADO urls', () => {
    assert.strictEqual(parseAdoRemote('https://github.com/foo/bar.git'), undefined);
    assert.strictEqual(parseAdoRemote('git@github.com:foo/bar.git'), undefined);
    assert.strictEqual(parseAdoRemote(''), undefined);
    assert.strictEqual(parseAdoRemote('not a url'), undefined);
  });

  it('returns undefined for ADO host without _git path', () => {
    assert.strictEqual(parseAdoRemote('https://dev.azure.com/myorg/myproj'), undefined);
  });
});
