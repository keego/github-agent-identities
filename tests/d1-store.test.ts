import assert from "node:assert/strict";
import { test } from "node:test";
import { D1BindingStore, type SqlDatabase, type SqlStatement } from "../src/d1-store.ts";
import { IdentityRouter, getChatIdentity, exampleIdentities } from "../src/core.ts";

function fakeDatabase() {
  const rows = new Map<string, string>();
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const db: SqlDatabase = {
    prepare(sql: string): SqlStatement {
      let args: unknown[] = [];
      const statement: SqlStatement = {
        bind(...values: unknown[]) { args = values; return statement; },
        async first<T>() {
          queries.push({ sql, args: [...args] });
          return (rows.has(String(args[0])) ? { identity_id: rows.get(String(args[0])) } : null) as T | null;
        },
        async run() {
          queries.push({ sql, args: [...args] });
          rows.set(String(args[0]), String(args[1]));
          return {};
        },
      };
      return statement;
    },
  };
  return { db, rows, queries };
}

const meta = (subject: string, session: string) => ({
  "openai/subject": subject,
  "openai/session": session,
});

test("D1 adapter reads missing rows and writes with parameterized queries", async () => {
  const { db, queries } = fakeDatabase();
  const store = new D1BindingStore(db);
  assert.equal(await store.read("key-1"), null);
  await store.write("key-1", "design");
  assert.equal(await store.read("key-1"), "design");
  assert.ok(queries.every(q => q.sql.includes("?1")));
  assert.deepEqual(queries[1].args, ["key-1", "design"]);
});

test("D1-backed router preserves independent role bindings across instances", async () => {
  const { db } = fakeDatabase();
  const one = new IdentityRouter(new D1BindingStore(db), exampleIdentities);
  const two = new IdentityRouter(new D1BindingStore(db), exampleIdentities);
  await one.bind(meta("user", "chat-1"), "design");
  await one.bind(meta("user", "chat-2"), "qa");
  assert.equal((await two.identify(meta("user", "chat-1"))).identity?.id, "design");
  assert.equal((await two.identify(meta("user", "chat-2"))).identity?.id, "qa");
});

test("D1-backed store isolates same session IDs belonging to different subjects", async () => {
  const { db, rows } = fakeDatabase();
  const router = new IdentityRouter(new D1BindingStore(db), exampleIdentities);
  await router.bind(meta("user-A", "same"), "design");
  assert.equal((await router.identify(meta("user-B", "same"))).registered, false);
  assert.equal(rows.size, 1);
  const hashed = (await getChatIdentity(meta("user-A", "same"))).key;
  assert.ok(rows.has(hashed));
  assert.ok(!rows.has("user-A:same"));
});

test("upsert changes only the selected conversation's binding", async () => {
  const { db } = fakeDatabase();
  const router = new IdentityRouter(new D1BindingStore(db), exampleIdentities);
  await router.bind(meta("user", "one"), "qa");
  await router.bind(meta("user", "two"), "dev");
  await router.bind(meta("user", "one"), "design");
  assert.equal((await router.identify(meta("user", "one"))).identity?.id, "design");
  assert.equal((await router.identify(meta("user", "two"))).identity?.id, "dev");
});
