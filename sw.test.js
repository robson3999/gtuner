import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function setup(scope) {
  const events = {};
  const stores = new Map();
  const key = (request) => typeof request === "string" ? request : request.url;
  const caches = {
    async open(name) {
      if (!stores.has(name)) {
        const entries = new Map();
        stores.set(name, {
          async addAll(requests) {
            for (const request of requests) {
              const path = request.url.slice(scope.length) || "index.html";
              entries.set(key(request), readFileSync(new URL(path, import.meta.url)));
            }
          },
          async match(request) { return entries.get(key(request)); },
        });
      }
      return stores.get(name);
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  vm.runInNewContext(readFileSync(new URL("./sw.js", import.meta.url), "utf8"), {
    URL, Request, caches,
    self: { registration: { scope }, clients: { async claim() {} }, addEventListener(name, callback) { events[name] = callback; } },
    fetch() { throw new Error("Network is offline"); },
  });
  return {
    caches,
    async lifecycle(name) {
      let completion;
      events[name]({ waitUntil(promise) { completion = promise; } });
      await completion;
    },
    fetch(path, options = {}) {
      let response;
      events.fetch({
        request: { url: new URL(path, scope).href, method: "GET", mode: "cors", ...options },
        respondWith(promise) { response = promise; },
      });
      return response;
    },
  };
}

for (const path of ["/", "/tuner/"]) {
  test(`offline launches and all page dependencies work under ${path}`, async () => {
    const worker = setup(`https://example.com${path}`);
    await worker.lifecycle("install");
    await worker.lifecycle("activate");
    const original = readFileSync(new URL("./index.html", import.meta.url), "utf8");
    for (const home of ["./", "./index.html", "./?source=homescreen", "./index.html?source=homescreen"]) {
      assert.equal((await worker.fetch(home, { mode: "navigate" })).toString(), original);
    }
    const assets = [...original.matchAll(/(?:href|src)="(\.\/[^" ]+)"/g)].map((match) => match[1]);
    assets.push("./pitch.js");
    const manifest = JSON.parse((await worker.fetch("./manifest.webmanifest")).toString());
    assets.push(...manifest.icons.map((icon) => icon.src));
    for (const asset of assets) assert.ok((await worker.fetch(asset)).length, `${asset} is available offline`);
    await assert.rejects(worker.fetch("./missing.js"), /Network is offline/);
  });
}

test("activation removes only this installation's old caches", async () => {
  const worker = setup("https://example.com/tuner/");
  await worker.caches.open("tuner-https://example.com/tuner/-old");
  await worker.caches.open("tuner-https://example.com/other/-v1");
  await worker.caches.open("another-app");
  await worker.lifecycle("install");
  await worker.lifecycle("activate");
  const names = await worker.caches.keys();
  assert.equal(names.length, 3);
  assert.ok(!names.includes("tuner-https://example.com/tuner/-old"));
  assert.ok(names.includes("tuner-https://example.com/other/-v1"));
  assert.ok(names.includes("another-app"));
});

test("non-GET requests and URLs outside the app bypass the worker", () => {
  const worker = setup("https://example.com/tuner/");
  assert.equal(worker.fetch("./", { method: "POST" }), undefined);
  assert.equal(worker.fetch("https://another.example/tuner/"), undefined);
  assert.equal(worker.fetch("/other/"), undefined);
});
