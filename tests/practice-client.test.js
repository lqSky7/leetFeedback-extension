"use strict";
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const store = { auth_user: { id: 9 } };
const context = {
  crypto: { randomUUID: () => "stable-request-key" },
  performance: { now: () => 10000 },
  Date,
  console,
  location: { hostname: "test.invalid", pathname: "/problems/two-sum/" },
  document: { hidden: false },
  chrome: {
    storage: {
      local: {
        get: async (keys) =>
          Object.fromEntries(keys.map((key) => [key, store[key]])),
        set: async (values) =>
          Object.assign(store, JSON.parse(JSON.stringify(values))),
      },
    },
  },
  Traverse: { config: { keys: { auth: { user: "auth_user" } } } },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("core/practice-client.js", "utf8"), context);
const Client = context.Traverse.PracticeClient;
(async () => {
  const client = new Client();
  assert(await client.scope());
  client.record = {
    session: { sessionId: 3, lastSequence: 0 },
    events: [],
    desiredState: "active",
    assistance: "unknown",
  };
  client.event("progress", 15);
  client.event("pause");
  await client.persist();
  const before = JSON.stringify(client.record.events);
  client.request = async () => {
    throw new Error("offline");
  };
  await assert.rejects(() => client.flush());
  assert.strictEqual(JSON.stringify(client.record.events), before);
  let payload;
  client.request = async (path, method, body) => {
    payload = { path, method, body };
    return { sessionId: 3, lastSequence: 2, state: "paused" };
  };
  await client.flush();
  assert.strictEqual(payload.path, "/api/v1/practice/sessions/3/events");
  assert.strictEqual(payload.body.events[0].sequence, 1);
  assert.strictEqual(payload.body.events[0].activeSeconds, 15);
  assert.strictEqual(payload.body.events[1].sequence, 2);
  assert.strictEqual(client.record.events.length, 0);
  store.auth_user = { id: 10 };
  await client.scope();
  assert.strictEqual(client.record, null);
  assert(client.storageKey.endsWith(".10"));
  assert(store["traverse.practice.events.v1.9"]);
  const owned = new Client();
  await owned.scope();
  owned.record = {
    slug: "two-sum",
    owner: owned.owner,
    session: { sessionId: 4, lastSequence: 0 },
    events: [],
    desiredState: "active",
  };
  owned.request = async () => {
    throw new Error("offline");
  };
  await owned.accepted("hint");
  assert.strictEqual(owned.record.assistance, "hint");
  assert.strictEqual(owned.record.events[0].kind, "end");
  assert.strictEqual(owned.record.desiredState, "ended");
  assert.strictEqual(store[owned.storageKey].events[0].sequence, 1);
  console.log(
    "Practice telemetry: durable retries, sequence IDs, account isolation, accepted end passed",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
