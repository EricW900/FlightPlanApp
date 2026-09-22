import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { buildRoutePath } from "../src/geo.ts";

test("globe uses the supplied spherical path and the aircraft stays on its altitude", () => {
  const values = {};
  const listeners = {};
  const elements = new WeakMap();
  let created = 0;
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
      location: { origin: "http://localhost" },
      parent: { postMessage() {} },
      addEventListener: (type, listener) => { listeners[type] = listener; }
    },
    requestAnimationFrame: fn => fn()
  });
  const html = readFileSync(new URL("../public/globe.html", import.meta.url), "utf8");
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  const send = data => listeners.message({ origin: "http://localhost", data });
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

  send({ type: "AIRCRAFT", ...path[1], ahead: path[2], follow: false });
  const marker = values.htmlElementsData.at(-1);
  const count = created;
  send({ type: "AIRCRAFT", ...path[2], ahead: path[3], follow: true });
  assert.equal(values.htmlElementsData.at(-1), marker);
  assert.equal(created, count);
  assert.equal(marker.lat, path[2].lat);
  assert.equal(values.pointOfView.lat, path[2].lat);
  assert.match(elements.get(marker).firstElementChild.style.transform, /^rotate\(/);
  send({ type: "RESET" });
  assert.equal(values.pathsData.length, 0);
  assert.equal(values.htmlElementsData.length, 0);
});
