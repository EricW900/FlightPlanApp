
export type Coordinate = {
  lat: number;
  lng: number;
};

export type Airport = Coordinate & {
  code: string;
  name: string;
  city: string;
  country: string;
};

export type Waypoint = Coordinate & {
  ident: string;
  country: string;
};

export type RoutePoint = Coordinate & {
  ident: string;
  type: "airport" | "fix";
};

const EARTH_RADIUS_NM = 3440.065;

function radians(degrees: number) {
  return degrees * Math.PI / 180;
}

function degrees(value: number) {
  return value * 180 / Math.PI;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

// Distância entre dois pontos, em milhas náuticas.
export function distanceNM(
  a: Coordinate,
  b: Coordinate
): number {
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);

  const deltaLat = radians(b.lat - a.lat);
  const deltaLng = radians(b.lng - a.lng);

  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) *
    Math.cos(lat2) *
    Math.sin(deltaLng / 2) ** 2;

  const angle = 2 * Math.asin(
    Math.sqrt(clamp(h, 0, 1))
  );

  return EARTH_RADIUS_NM * angle;
}

// Converte latitude e longitude para um vetor 3D.
function toVector(point: Coordinate) {
  const lat = radians(point.lat);
  const lng = radians(point.lng);

  return {
    x: Math.cos(lat) * Math.cos(lng),
    y: Math.cos(lat) * Math.sin(lng),
    z: Math.sin(lat)
  };
}

// Interpolação esférica entre dois pontos.
export function interpolate(
  a: Coordinate,
  b: Coordinate,
  progress: number
): Coordinate {
  const t = clamp(progress, 0, 1);

  const v1 = toVector(a);
  const v2 = toVector(b);

  const dot = clamp(
    v1.x * v2.x +
    v1.y * v2.y +
    v1.z * v2.z,
    -1,
    1
  );

  const angle = Math.acos(dot);

  if (angle < 0.000001) {
    return { lat: a.lat, lng: a.lng };
  }

  const sinAngle = Math.sin(angle);

  // Pontos quase antipodais exigiriam escolher
  // explicitamente uma das trajetórias possíveis.
  if (Math.abs(sinAngle) < 0.000001) {
    return { lat: a.lat, lng: a.lng };
  }

  const factorA =
    Math.sin((1 - t) * angle) / sinAngle;

  const factorB =
    Math.sin(t * angle) / sinAngle;

  const x = factorA * v1.x + factorB * v2.x;
  const y = factorA * v1.y + factorB * v2.y;
  const z = factorA * v1.z + factorB * v2.z;

  return {
    lat: degrees(
      Math.atan2(z, Math.sqrt(x * x + y * y))
    ),
    lng: degrees(Math.atan2(y, x))
  };
}

// Gera a rota com aeroportos e waypoints.
export function generateRoute(
  origin: Airport,
  destination: Airport,
  waypoints: Waypoint[]
): RoutePoint[] {
  const start: RoutePoint = {
    ident: origin.code,
    lat: origin.lat,
    lng: origin.lng,
    type: "airport"
  };

  const end: RoutePoint = {
    ident: destination.code,
    lat: destination.lat,
    lng: destination.lng,
    type: "airport"
  };

  const directDistance =
    distanceNM(start, end);

  if (directDistance < 30) {
    return [start, end];
  }

  const sampleCount = Math.min(
    5,
    Math.max(1, Math.round(directDistance / 400))
  );

  // Distância máxima permitida entre o waypoint
  // e sua posição ideal sobre o trajeto direto.
  const searchRadius = Math.max(
    75,
    Math.min(180, directDistance * 0.10)
  );

  const selected: RoutePoint[] = [];
  const used = new Set<string>();

  let previousProgress = 0;

  for (let i = 1; i <= sampleCount; i++) {
    const progress = i / (sampleCount + 1);

    const target = interpolate(
      start,
      end,
      progress
    );

    let best: Waypoint | null = null;

    let bestDistance = Infinity;
    let bestProgress = 0;

    for (const waypoint of waypoints) {
      const key =
        `${waypoint.ident}:${waypoint.lat}:${waypoint.lng}`;

      if (used.has(key)) continue;

      const fromOrigin =
        distanceNM(start, waypoint);

      const toDestination =
        distanceNM(waypoint, end);

      // Evita pontos próximos demais dos aeroportos.
      if (
        fromOrigin < 20 ||
        toDestination < 20
      ) {
        continue;
      }

      // Evita grandes desvios em relação
      // à distância geográfica direta.
      if (
        fromOrigin + toDestination >
        directDistance * 1.25 + 30
      ) {
        continue;
      }

      // Mantém os pontos avançando na rota.
      if (
        fromOrigin <= previousProgress + 10
      ) {
        continue;
      }

      const deviation =
        distanceNM(target, waypoint);

      if (
        deviation <= searchRadius &&
        deviation < bestDistance
      ) {
        best = waypoint;
        bestDistance = deviation;
        bestProgress = fromOrigin;
      }
    }

    if (best) {
      selected.push({
        ident: best.ident,
        lat: best.lat,
        lng: best.lng,
        type: "fix"
      });

      used.add(
        `${best.ident}:${best.lat}:${best.lng}`
      );

      previousProgress = bestProgress;
    }
  }

  return [start, ...selected, end];
}

// Soma a distância dos trechos consecutivos.
export function routeDistance(
  route: RoutePoint[]
): number {
  let total = 0;

  for (let i = 0; i < route.length - 1; i++) {
    total += distanceNM(
      route[i],
      route[i + 1]
    );
  }

  return total;
}

// Retorna a posição do avião para uma
// determinada distância percorrida.
export function positionAtDistance(
  route: RoutePoint[],
  traveledNM: number
) {
  if (!route.length) {
    return {
      lat: 0,
      lng: 0,
      next: "",
      segment: 0
    };
  }

  let remaining = Math.max(0, traveledNM);

  for (let i = 0; i < route.length - 1; i++) {
    const start = route[i];
    const end = route[i + 1];

    const segmentDistance =
      distanceNM(start, end);

    if (remaining <= segmentDistance) {
      const position = interpolate(
        start,
        end,
        segmentDistance > 0
          ? remaining / segmentDistance
          : 1
      );

      return {
        ...position,
        next: end.ident,
        segment: i + 1
      };
    }

    remaining -= segmentDistance;
  }

  const destination = route[route.length - 1];

  return {
    lat: destination.lat,
    lng: destination.lng,
    next: "Destino",
    segment: route.length - 1
  };
}