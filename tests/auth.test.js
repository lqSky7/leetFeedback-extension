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

async function testLoginStoresSession() {
  resetStorage();
  const auth = new ExtensionAuth({ fetch: createMockFetch() });

  await auth.login({
    username: 'admin',
    password: 'admin',
  });

  assert.strictEqual(auth.isAuthenticated, true);
  assert.strictEqual(auth.token, 'admin-token');
  assert.strictEqual(auth.user.username, 'admin');

  const stored = await chrome.storage.local.get([
    'auth_user',
    'auth_token',
    'auth_timestamp',
  ]);

  assert.strictEqual(stored.auth_user.username, 'admin');
  assert.strictEqual(stored.auth_token, 'admin-token');
  assert.strictEqual(Number.isFinite(stored.auth_timestamp), true);
}

async function testLoggingInAgainReplacesSession() {
  resetStorage();
  const auth = new ExtensionAuth({ fetch: createMockFetch() });

  await auth.login({ username: 'alice', password: 'alice-pass' });
  assert.strictEqual(auth.user.username, 'alice');

  await auth.login({ username: 'bob', password: 'bob-pass' });
  assert.strictEqual(auth.user.username, 'bob');
  assert.strictEqual(auth.token, 'bob-token');

  const stored = await chrome.storage.local.get(['auth_user', 'auth_token']);
  assert.strictEqual(stored.auth_user.username, 'bob');
  assert.strictEqual(stored.auth_token, 'bob-token');
}

async function testSignOutClearsSession() {
  resetStorage();
  const auth = new ExtensionAuth({ fetch: createMockFetch() });

  await auth.login({ username: 'alice', password: 'alice-pass' });
  await auth.signOut();

  assert.strictEqual(auth.isAuthenticated, false);
  assert.strictEqual(auth.user, null);
  assert.strictEqual(auth.token, null);

  const stored = await chrome.storage.local.get([
    'auth_user',
    'auth_token',
    'auth_timestamp',
  ]);
  assert.strictEqual(stored.auth_user, undefined);
  assert.strictEqual(stored.auth_token, undefined);
  assert.strictEqual(stored.auth_timestamp, undefined);
}

async function testSyncFromStorageRestoresSession() {
  resetStorage();
  const seedAuth = new ExtensionAuth({ fetch: createMockFetch() });
  await seedAuth.login({ username: 'carol', password: 'carol-pass' });

  const restoredAuth = new ExtensionAuth({ fetch: createMockFetch() });
  await restoredAuth.syncFromStorage();

  assert.strictEqual(restoredAuth.isAuthenticated, true);
  assert.strictEqual(restoredAuth.user.username, 'carol');
  assert.strictEqual(restoredAuth.token, 'carol-token');
}

(async () => {
  try {
    await testPickers();
    await testLoginStoresSession();
    await testLoggingInAgainReplacesSession();
    await testSignOutClearsSession();
    await testSyncFromStorageRestoresSession();
    console.log('Auth tests passed');
  } catch (error) {
    console.error('Auth tests failed:', error);
    process.exit(1);
  }
})();
