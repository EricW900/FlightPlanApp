import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { buildRoutePath } from "../src/geo.ts";

for (const location of [
  { protocol: "https:", origin: "https://aeroroute.example" },
  { protocol: "file:", origin: "null" },
  { protocol: "file:", origin: "file://" },
]) {
test(`globe route and aircraft bridge works on ${location.protocol} (${location.origin})`, () => {
  const values = {};
  const listeners = {};
  const elements = new WeakMap();
  let created = 0;
  const sent = [];
  const parent = { postMessage: (data, origin) => sent.push({ data, origin }) };
  const world = new Proxy({}, {
    get: (_, method) => (...args) => {
      if (method === "controls") return { addEventListener() {} };
      if (method === "getScreenCoords") return { x: args[1], y: -args[0] };
      values[method] = args[0];
      if (method === "htmlElementsData") {
        for (const datum of args[0]) {
          if (!elements.has(datum)) {
            elements.set(datum, values.htmlElement(datum));
            created++;
          }
        }
      }
      return world;
    }
  });
  const context = vm.createContext({
    Globe: function () { return world; },
    document: {
      getElementById: () => ({}),
      createElement: () => ({ firstElementChild: { style: {} } })
    },
    window: {
      location,
      parent,
      addEventListener: (type, listener) => { listeners[type] = listener; }
    },
    requestAnimationFrame: fn => fn()
  });
  const html = readFileSync(new URL("../public/globe.html", import.meta.url), "utf8");
  assert.match(html, /backgroundImageUrl\([\s\S]*night-sky\.png/);
  assert.match(html, /earth-blue-marble\.jpg/);
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  assert.equal(sent[0].data.type, "READY");
  assert.equal(sent[0].origin, location.protocol === "file:" ? "*" : location.origin);
  const send = data => listeners.message({ origin: location.origin, source: parent, data });
  const points = [
    { ident: "A", lat: -35, lng: -70, type: "airport" },
    { ident: "B", lat: -37, lng: 175, type: "airport" }
  ];
  const path = buildRoutePath(points);
  send({ type: "ROUTE", points, path });
  assert.equal(values.pathsData[0].coords.length, path.length);
  assert.ok(path.length > points.length);
  assert.equal(values.pathResolution, Infinity);
  assert.equal(values.pathTransitionDuration, 0);
  assert.equal(values.htmlTransitionDuration, 0);
  assert.equal(values.pathPointAlt, values.htmlAltitude);
  assert.match(values.backgroundImageUrl, /night-sky\.png$/);

  send({ type: "AIRCRAFT", ...path[1], ahead: path[2], follow: false });
  const marker = values.htmlElementsData.at(-1);
  const count = created;
  send({ type: "AIRCRAFT", ...path[2], ahead: path[3], follow: true });
  assert.equal(values.htmlElementsData.at(-1), marker);
  assert.equal(created, count);
  assert.equal(marker.lat, path[2].lat);
  assert.equal(values.pointOfView.lat, path[2].lat);
  assert.match(elements.get(marker).firstElementChild.style.transform, /^rotate\(/);
  // Mesmo em file://, outras janelas não podem comandar o globo.
  listeners.message({ origin: location.origin, source: {}, data: { type: "RESET" } });
  assert.equal(values.pathsData.length, 1);
  if (location.protocol === "https:") {
    listeners.message({ origin: "https://untrusted.example", source: parent, data: { type: "RESET" } });
    assert.equal(values.pathsData.length, 1);
  }
  send({ type: "RESET" });
  assert.equal(values.pathsData.length, 0);
  assert.equal(values.htmlElementsData.length, 0);
});
}
