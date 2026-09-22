import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildRoutePath, distanceNM, generateRoute, interpolate,
  positionAtDistance, routeDistance
} from "../src/geo.ts";

const airports = JSON.parse(readFileSync(new URL("../public/airports.json", import.meta.url)));
const waypoints = JSON.parse(readFileSync(new URL("../public/waypoints.json", import.meta.url)));
const airport = code => airports.find(point => point.code === code);
const fixKey = p => `${p.ident}:${p.lat}:${p.lng}`;
const knownFixes = new Set(waypoints.map(fixKey));
const point = (ident, lat, lng) => ({ ident, lat, lng, type: "fix" });

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

function checkRoute(route, origin, destination) {
  assert.equal(route[0].ident, origin.code);
  assert.equal(route.at(-1).ident, destination.code);
  assert.equal(new Set(route.map(fixKey)).size, route.length);
  assert.ok(routeDistance(route) <= distanceNM(origin, destination) * 1.1);
  for (let i = 1; i < route.length; i++) {
    assert.ok(distanceNM(route[i - 1], route[i]) <= 120 + 1e-6);
    assert.ok(distanceNM(route[i - 1], route[i]) > 0);
    assert.ok(distanceNM(origin, route[i]) > distanceNM(origin, route[i - 1]));
    if (route[i].type === "fix") assert.ok(knownFixes.has(fixKey(route[i])));
  }
  const arrival = positionAtDistance(route, routeDistance(route));
  near(distanceNM(arrival, destination), 0);
  assert.equal(arrival.next, "Destino");
}

for (const [from, to] of [
  ["SCEL", "NZAA"], ["NZAA", "SCEL"], ["SBGR", "SBGL"],
  ["KJFK", "EGLL"], ["YSSY", "RJTT"]
]) {
  test(`real dataset: ${from}–${to} has ordered, bounded legs and only known fixes`, () => {
    const origin = airport(from);
    const destination = airport(to);
    const route = generateRoute(origin, destination, waypoints);
    checkRoute(route, origin, destination);
    if (from === "SCEL" || to === "SCEL") {
      assert.ok(route.length > 30);
      assert.ok(route.some(p => p.type === "fix"));
      assert.ok(route.some(p => p.type === "coordinate"));
      assert.ok(route.some(p => p.lng < -170) && route.some(p => p.lng > 170));
      assert.ok(route.every(p => p.lat < -30 && p.lat > -60));
    }
    if (from === "KJFK") assert.ok(route.filter(p => p.type === "fix").length > 5);
  });
}

test("oceanic gaps use explicitly calculated coordinates without inventing fixes", () => {
  const origin = airport("SCEL");
  const destination = airport("NZAA");
  const route = generateRoute(origin, destination, []);
  checkRoute(route, origin, destination);
  assert.ok(route.slice(1, -1).every(p => p.type === "coordinate"));
  near(routeDistance(route), distanceNM(origin, destination));
});

test("waypoint order, duplicates and invalid coordinates do not change the route", () => {
  const origin = airport("SCEL");
  const destination = airport("NZAA");
  const expected = generateRoute(origin, destination, waypoints);
  const input = [...waypoints].reverse();
  input.push(...waypoints.slice(0, 50),
    { ident: "BAD", lat: NaN, lng: -100 },
    { ident: "BAD", lat: -40, lng: 181 },
    { ident: "BAD", lat: -91, lng: -100 });
  assert.deepEqual(generateRoute(origin, destination, input), expected);
});

test("rendered path and aircraft agree along every leg, including the dateline", () => {
  // Also exercise a single long leg: this exposed the original lat/lng line bug.
  for (const route of [
    [point("SCEL", airport("SCEL").lat, airport("SCEL").lng),
      point("NZAA", airport("NZAA").lat, airport("NZAA").lng)],
    generateRoute(airport("SCEL"), airport("NZAA"), waypoints),
    generateRoute(airport("NZAA"), airport("SCEL"), waypoints)
  ]) {
    const path = buildRoutePath(route);
    let traveled = 0;
    for (let i = 1; i < path.length; i++) {
      const leg = distanceNM(path[i - 1], path[i]);
      assert.ok(leg <= 10 + 1e-6);
      assert.ok(Math.abs(path[i].lng - path[i - 1].lng) <= 180);
      const midway = positionAtDistance(route, traveled + leg / 2);
      near(distanceNM(midway, interpolate(path[i - 1], path[i], 0.5)), 0);
      traveled += leg;
      near(distanceNM(path[i], positionAtDistance(route, traveled)), 0);
    }
    near(traveled, routeDistance(route));
    near(distanceNM(path.at(-1), route.at(-1)), 0);
  }
});

test("spherical interpolation handles the dateline, poles and antipodes", () => {
  const cases = [
    [{ lat: -40, lng: 179 }, { lat: -40, lng: -179 }],
    [{ lat: 85, lng: -90 }, { lat: 85, lng: 90 }],
    [{ lat: 0, lng: 0 }, { lat: 0, lng: 180 }],
    [{ lat: 10, lng: 20 }, { lat: -10.00001, lng: -159.99999 }],
    [{ lat: 20, lng: 30 }, { lat: 20, lng: 30 }]
  ];
  for (const [a, b] of cases) {
    assert.deepEqual(interpolate(a, b, 0), a);
    assert.deepEqual(interpolate(a, b, 1), b);
    for (const progress of [0.1, 0.5, 0.9]) {
      const current = interpolate(a, b, progress);
      assert.ok(Number.isFinite(current.lat) && Number.isFinite(current.lng));
      near(distanceNM(a, current), distanceNM(a, b) * progress, 0.0001);
    }
  }
  assert.ok(Math.abs(interpolate(...cases[0], 0.5).lng) > 179.9);
  near(interpolate(...cases[1], 0.5).lat, 90);
});

test("simulation handles empty routes, zero-length legs, fixes and arrival", () => {
  const a = point("A", 0, 0);
  const b = point("B", 0, 1);
  const c = point("C", 0, 2);
  assert.deepEqual(buildRoutePath([]), []);
  assert.equal(positionAtDistance([], 10).next, "");
  assert.equal(positionAtDistance([a], 10).next, "Destino");
  near(distanceNM(positionAtDistance([a, b], -10), a), 0);
  assert.equal(positionAtDistance([a, a, b, c], 0).next, "B");
  assert.equal(positionAtDistance([a, b, c], distanceNM(a, b)).next, "C");
  assert.equal(positionAtDistance([a, b, c], 10000).next, "Destino");
  const origin = { ...airport("SCEL"), lat: 0, lng: 0 };
  const destination = { ...airport("NZAA"), lat: 0, lng: 0.1 };
  assert.equal(generateRoute(origin, destination, waypoints).length, 2);
});
