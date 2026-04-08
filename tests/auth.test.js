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

function createMockFetch() {
  return async (_url, options = {}) => {
    const body =
      typeof options.body === 'string' ? JSON.parse(options.body) : {};
    const username = body.username || 'unknown';

    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          token: `${username}-token`,
          user: {
            username,
            email: `${username}@example.com`,
          },
        }),
    };
  };
}

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

async function testLoginStoresActiveAccount() {
  resetStorage();
  const auth = new ExtensionAuth({ fetch: createMockFetch() });

  await auth.login({
    username: 'admin',
    password: 'admin',
  });

  assert.strictEqual(auth.isAuthenticated, true);
  assert.strictEqual(auth.token, 'admin-token');

  const stored = await chrome.storage.local.get([
    'auth_accounts',
    'auth_active_account_id',
    'auth_user',
    'auth_token',
  ]);

  assert.strictEqual(Array.isArray(stored.auth_accounts), true);
  assert.strictEqual(stored.auth_accounts.length, 1);
  assert.strictEqual(stored.auth_accounts[0].user.username, 'admin');
  assert.strictEqual(
    Number.isFinite(stored.auth_accounts[0].timestamp),
    true,
  );
  assert.strictEqual(stored.auth_user.username, 'admin');
  assert.strictEqual(stored.auth_token, 'admin-token');
  assert.strictEqual(
    stored.auth_active_account_id,
    stored.auth_accounts[0].id,
  );
}

async function testSwitchingBetweenMultipleAccounts() {
  resetStorage();
  const auth = new ExtensionAuth({ fetch: createMockFetch() });

  await auth.login({
    username: 'alice',
    password: 'alice-pass',
  });

  const aliceId = auth.getAccounts()[0].id;

  await auth.login({
    username: 'bob',
    password: 'bob-pass',
  });

  assert.strictEqual(auth.getAccounts().length, 2);
  assert.strictEqual(auth.user.username, 'bob');

  await auth.switchAccount(aliceId);

  assert.strictEqual(auth.user.username, 'alice');
  assert.strictEqual(auth.token, 'alice-token');

  const stored = await chrome.storage.local.get([
    'auth_active_account_id',
    'auth_user',
    'auth_token',
  ]);
  assert.strictEqual(stored.auth_active_account_id, aliceId);
  assert.strictEqual(stored.auth_user.username, 'alice');
  assert.strictEqual(stored.auth_token, 'alice-token');
}

async function testSignOutRemovesOnlyActiveAccount() {
  resetStorage();
  const auth = new ExtensionAuth({ fetch: createMockFetch() });

  await auth.login({ username: 'alice', password: 'alice-pass' });
  await auth.login({ username: 'bob', password: 'bob-pass' });

  await auth.signOut();

  assert.strictEqual(auth.isAuthenticated, true);
  assert.strictEqual(auth.user.username, 'alice');
  assert.strictEqual(auth.getAccounts().length, 1);

  await auth.signOut();

  assert.strictEqual(auth.isAuthenticated, false);
  assert.strictEqual(auth.getAccounts().length, 0);

  const stored = await chrome.storage.local.get([
    'auth_accounts',
    'auth_user',
    'auth_token',
  ]);
  assert.strictEqual(stored.auth_accounts, undefined);
  assert.strictEqual(stored.auth_user, undefined);
  assert.strictEqual(stored.auth_token, undefined);
}

(async () => {
  try {
    await testPickers();
    await testLoginStoresActiveAccount();
    await testSwitchingBetweenMultipleAccounts();
    await testSignOutRemovesOnlyActiveAccount();
    console.log('Auth tests passed');
  } catch (error) {
    console.error('Auth tests failed:', error);
    process.exit(1);
  }
})();
