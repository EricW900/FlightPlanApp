
import { parse } from "csv-parse/sync";

import fs from "node:fs/promises";

import path from "node:path";

const AIRPORTS_URL =
  "https://davidmegginson.github.io/ourairports-data/airports.csv";

const WAYPOINTS_URL =
  "https://raw.githubusercontent.com/Anoerak/global-aviation-waypoints/main/global_aviation_waypoints.csv";

const PUBLIC_DIR = path.resolve("public");

await fs.mkdir(PUBLIC_DIR, { recursive: true });

async function downloadCSV(url) {
  console.log("Baixando:", url);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Erro HTTP ${response.status}: ${url}`
    );
  }

  const csv = await response.text();

  return parse(csv, {
    columns: true,
    skip_empty_lines: true,
    bom: true
  });
}

function validCoordinate(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

async function prepareAirports() {
  const rows = await downloadCSV(AIRPORTS_URL);

  const airportsMap = new Map();

  for (const row of rows) {
    const code = (
      row.icao_code ||
      row.ident ||
      ""
    ).trim().toUpperCase();

    if (!/^[A-Z]{4}$/.test(code)) continue;

    if (row.type === "closed") continue;

    if (
      !row.latitude_deg ||
      !row.longitude_deg
    ) continue;

    const lat = Number(row.latitude_deg);
    const lng = Number(row.longitude_deg);

    if (!validCoordinate(lat, lng)) continue;

    if (airportsMap.has(code)) continue;

    airportsMap.set(code, {
      code,
      name: row.name || code,
      city: row.municipality || "",
      country: row.iso_country || "",
      lat,
      lng
    });
  }

  const airports = [...airportsMap.values()];

  await fs.writeFile(
    path.join(PUBLIC_DIR, "airports.json"),
    JSON.stringify(airports),
    "utf8"
  );

  console.log(
    `Aeroportos preparados: ${airports.length}`
  );
}

async function prepareWaypoints() {
  const rows = await downloadCSV(WAYPOINTS_URL);

  const waypoints = [];
  const registered = new Set();

  for (const row of rows) {
    const ident = (
      row.IDENT || ""
    ).trim().toUpperCase();

    if (!/^[A-Z0-9]{2,8}$/.test(ident)) {
      continue;
    }

    if (!row.LATITUDE || !row.LONGITUDE) {
      continue;
    }

    const lat = Number(row.LATITUDE);
    const lng = Number(row.LONGITUDE);

    if (!validCoordinate(lat, lng)) continue;

    const country = row.COUNTRY_CODE || "";

    const key =
      `${ident}:${lat}:${lng}`;

    if (registered.has(key)) continue;

    registered.add(key);

    waypoints.push({
      ident,
      country,
      lat,
      lng
    });
  }

  await fs.writeFile(
    path.join(PUBLIC_DIR, "waypoints.json"),
    JSON.stringify(waypoints),
    "utf8"
  );

  console.log(
    `Waypoints preparados: ${waypoints.length}`
  );
}

try {
  await prepareAirports();
  await prepareWaypoints();

  console.log("Preparação concluída.");
} catch (error) {
  console.error("Erro ao preparar dados:", error);
  process.exitCode = 1;
}