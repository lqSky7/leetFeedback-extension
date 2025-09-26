'use strict';

const assert = require('assert');

const storageData = {};

function resetStorage() {
  Object.keys(storageData).forEach((key) => delete storageData[key]);
}

global.chrome = {
  storage: {
    local: {
      async get(keys = null) {
        if (!keys) {
          return { ...storageData };
        }

        if (Array.isArray(keys)) {
          const result = {};
          keys.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(storageData, key)) {
              result[key] = storageData[key];
            }
          });
          return result;
        }

        if (typeof keys === 'string') {
          if (Object.prototype.hasOwnProperty.call(storageData, keys)) {
            return { [keys]: storageData[keys] };
          }
          return {};
        }

        if (typeof keys === 'object' && keys !== null) {
          const result = { ...keys };
          Object.keys(keys).forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(storageData, key)) {
              result[key] = storageData[key];
            }
          });
          return result;
        }

        return {};
      },
      async set(items) {
        Object.assign(storageData, items);
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        list.forEach((key) => {
          delete storageData[key];
        });
      },
    },
  },
};

const authModule = require('../utils/auth.js');
const { ExtensionAuth } = authModule;

async function testPickers() {
  assert.strictEqual(ExtensionAuth.pickToken({ token: 'abc' }), 'abc');
  assert.strictEqual(
    ExtensionAuth.pickToken({ data: { access_token: 'xyz' } }),
    'xyz',
  );
  assert.strictEqual(ExtensionAuth.pickToken({}), null);

  const fallback = { username: 'fallback' };
  assert.deepStrictEqual(
    ExtensionAuth.pickUser({ data: { user: { username: 'admin' } } }),
    { username: 'admin' },
  );
  assert.strictEqual(ExtensionAuth.pickUser(null, fallback), fallback);
}

async function testLoginFlow() {
  resetStorage();

  const requests = [];
  const mockFetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          token: 'abc123',
          user: {
            username: 'admin',
            email: 'admin@example.com',
            github_username: 'lqsky7',
            github_repo: 'gfg',
          },
        }),
    };
  };

  const auth = new ExtensionAuth({ fetch: mockFetch });
  const result = await auth.login({
    email: 'admin@example.com',
    password: 'admin',
  });

  assert.strictEqual(result.token, 'abc123');
  assert.strictEqual(auth.isAuthenticated, true);
  assert.strictEqual(auth.token, 'abc123');

  const stored = await chrome.storage.local.get(['auth_user', 'auth_token']);
  assert.strictEqual(stored.auth_user.username, 'admin');
  assert.strictEqual(stored.auth_token, 'abc123');

  assert.strictEqual(
    requests[0].url.endsWith('/api/auth/login'),
    true,
  );
  const body = JSON.parse(requests[0].options.body);
  assert.strictEqual(body.email, 'admin@example.com');
  assert.strictEqual(body.username, undefined);

  await auth.signOut();
  const cleared = await chrome.storage.local.get(['auth_user', 'auth_token']);
  assert.strictEqual(cleared.auth_user, undefined);
  assert.strictEqual(cleared.auth_token, undefined);
  assert.strictEqual(auth.isAuthenticated, false);
}

async function testRegisterFlowWithoutToken() {
  resetStorage();

  const mockFetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ message: 'Registered' }),
  });

  const auth = new ExtensionAuth({ fetch: mockFetch });
  const result = await auth.register({
    username: 'admin',
    email: 'admin@example.com',
    password: 'admin',
    github_username: 'lqsky7',
    github_repo: 'gfg',
    github_branch: 'main',
  });

  assert.strictEqual(result.token, null);
  assert.strictEqual(auth.isAuthenticated, false);

  const stored = await chrome.storage.local.get(['auth_user']);
  assert.strictEqual(stored.auth_user, undefined);
}

(async () => {
  try {
    await testPickers();
    await testLoginFlow();
    await testRegisterFlowWithoutToken();
    console.log('Auth tests passed');
  } catch (error) {
    console.error('Auth tests failed:', error);
    process.exit(1);
  }
})();
