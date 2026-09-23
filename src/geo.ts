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
  type: "airport" | "fix" | "coordinate";
};

const EARTH_RADIUS_NM = 3440.065; // Raio médio da terra em NM
const WAYPOINT_SPACING_NM = 80; // Busca waypoints em faixas de aproximadamente 80 NM
const MAX_LEG_NM = 120; // Nenhum waypoint deve ter mais de 120 Nm de distância



// graus → radianos
function radians(degrees: number) {
  return degrees * Math.PI / 180;
}

// radianos → graus
function degrees(value: number) {
  return value * 180 / Math.PI;
}


// Força o valor a permanecer dentro de um intervalo
// Isso é útil em funções trigonométricas por causa de erros de ponto flutuante
function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}



// Distância entre dois pontos, em milhas náuticas.
// Usa a fórmula de Haversine por que estamos lidando com uma representação esférica da terra
export function distanceNM(a: Coordinate, b: Coordinate): number {

  // Converte latitude
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);

  const deltaLat = radians(b.lat - a.lat);
  const deltaLng = radians(b.lng - a.lng);

  const h = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  // Transforma o ângulo calculado em distância usando (distância = raio × ângulo)
  return EARTH_RADIUS_NM * 2 * Math.asin(Math.sqrt(clamp(h, 0, 1)));
}



//////////////////////////////////////////////////////////////////////
// Transforma latitude e longitude em um vetor 3D

function toVector(point: Coordinate) {
  const lat = radians(point.lat);
  const lng = radians(point.lng);
  return {
    x: Math.cos(lat) * Math.cos(lng),
    y: Math.cos(lat) * Math.sin(lng),
    z: Math.sin(lat)
  };
}

type Vector = ReturnType<typeof toVector>;

function dot(a: Vector, b: Vector) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vector, b: Vector): Vector {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function normalize(v: Vector): Vector {
  const length = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

//////////////////////////////////////////////////////////////////////

// Base do círculo máximo, independente da descontinuidade das longitudes
// É o caminho geodésico mais curto sobre uma esfera
function greatCircle(a: Coordinate, b: Coordinate) {
  const start = toVector(a);
  const end = toVector(b);
  const normal = cross(start, end);
  const sinAngle = Math.hypot(normal.x, normal.y, normal.z);
  const angle = Math.atan2(sinAngle, clamp(dot(start, end), -1, 1));

  // Antípodas exatos admitem vários caminhos: escolha um plano estável.
  const axis = Math.abs(start.z) < 0.9
    ? { x: 0, y: 0, z: 1 }
    : { x: 1, y: 0, z: 0 };
  const plane = normalize(sinAngle > 1e-12 ? normal : cross(start, axis));
  return { start, normal: plane, tangent: cross(plane, start), angle };
}

// Interpolação esférica compartilhada pelo desenho e pela simulação.
export function interpolate(a: Coordinate, b: Coordinate, progress: number): Coordinate {
  const t = clamp(progress, 0, 1);
  if (t === 0) return { lat: a.lat, lng: a.lng };
  if (t === 1) return { lat: b.lat, lng: b.lng };

  const { start, tangent, angle } = greatCircle(a, b);
  const factorA = Math.cos(t * angle);
  const factorB = Math.sin(t * angle);
  const x = factorA * start.x + factorB * tangent.x;
  const y = factorA * start.y + factorB * tangent.y;
  const z = factorA * start.z + factorB * tangent.z;
  return {
    lat: degrees(Math.atan2(z, Math.hypot(x, y))),
    lng: degrees(Math.atan2(y, x))
  };
}

function coordinateIdent(point: Coordinate) {
  return `${Math.abs(point.lat).toFixed(3)}${point.lat < 0 ? "S" : "N"}/` +
    `${Math.abs(point.lng).toFixed(3)}${point.lng < 0 ? "W" : "E"}`;
}

//////////////////////////////////////////////////////////////////////






// Planejamento geográfico para simulação; a base não contém aerovias,
// procedimentos ou restrições operacionais. Nunca invente um fix publicado.
export function generateRoute(
  origin: Airport,
  destination: Airport,
  waypoints: Waypoint[]
): RoutePoint[] {

  const start: RoutePoint = {
    ident: origin.code, lat: origin.lat, lng: origin.lng, type: "airport"
  };
  const end: RoutePoint = {
    ident: destination.code, lat: destination.lat, lng: destination.lng, type: "airport"
  };

  // Calcula distância
  const directDistance = distanceNM(start, end);

  if (directDistance < 30) return [start, end]; // Caso a distância seja muito pequena

  const circle = greatCircle(start, end);
  const bucketCount = Math.ceil(directDistance / WAYPOINT_SPACING_NM); // Buckets é um conjunto de waypoints
  const spacing = directDistance / bucketCount; // Ajusta o espaçamento para distribuir exatamente as faixas ao longo do trajeto
  const corridorWidth = clamp(directDistance * 0.02, 5, 20);
  const buckets = new Map<number, { //
    point: Waypoint;
    progress: number;
    score: number;
    key: string;
  }>();






  // Examina a base uma única vez, incluindo os trechos junto aos aeroportos.
  // Cada faixa de distância contribui com o fix mais próximo do trajeto.
  for (const point of waypoints) {
    if (!point.ident || !Number.isFinite(point.lat) || !Number.isFinite(point.lng) ||
      Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) continue;

    const vector = toVector(point);
    // Para verificar o quão distante estão os waypoints da rota
    const deviation = EARTH_RADIUS_NM * Math.abs(
      Math.asin(clamp(dot(vector, circle.normal), -1, 1))
    );
    if (deviation > corridorWidth) continue;


    const progress = EARTH_RADIUS_NM * Math.atan2(
      dot(vector, circle.tangent), dot(vector, circle.start)
    );
    if (progress < 10 || progress > directDistance - 10) continue;




    const bucket = Math.floor(progress / spacing);
    const score = deviation * 3 + Math.abs(progress - (bucket + 0.5) * spacing); // Pontuação para privilegiar waypoints próximos da rota e perto do centro da faixa, a penalização de desvio é multiplicado por 3, então ficar perto da rota pesa no resultado final
    const key = `${point.ident}:${point.lat}:${point.lng}`; // Critério de desempate
    const best = buckets.get(bucket);
    if (!best || score < best.score || (score === best.score && key < best.key)) {
      buckets.set(bucket, { point, progress, score, key });
    }
  }


  const selected: RoutePoint[] = [start];
  let previousProgress = 0;


  for (const { point, progress } of [...buckets.values()].sort((a, b) => a.progress - b.progress)) {
    const previous = selected[selected.length - 1];
    const advance = progress - previousProgress;

    // Impede recuos, pontos quase coincidentes e zigue-zagues no corredor
    if (advance < 20 || distanceNM(previous, point) > advance * 1.1 ||
      distanceNM(point, end) > (directDistance - progress) * 1.1) continue;
    selected.push({ ident: point.ident, lat: point.lat, lng: point.lng, type: "fix" });
    previousProgress = progress;
  }

  selected.push(end);

  // Em áreas sem cobertura, subdivida o trecho esférico por coordenadas.
  // Estes pontos são explicitamente diferentes dos fixes da base.
  const route: RoutePoint[] = [start];
  for (let i = 1; i < selected.length; i++) {
    const a = selected[i - 1];
    const b = selected[i];
    const legs = Math.ceil(distanceNM(a, b) / MAX_LEG_NM);
    for (let step = 1; step < legs; step++) {
      const point = interpolate(a, b, step / legs);
      route.push({ ...point, ident: coordinateIdent(point), type: "coordinate" });
    }
    route.push(b);
  }

  return route;
}



// Vértices para desenho
export function buildRoutePath(route: RoutePoint[]): Coordinate[] {
  if (!route.length) return [];

  const path: Coordinate[] = [{ lat: route[0].lat, lng: route[0].lng }];


  for (let i = 1; i < route.length; i++) {
    const start = route[i - 1];
    const end = route[i];
    const steps = Math.max(1, Math.ceil(distanceNM(start, end) / 10));

    for (let step = 1; step <= steps; step++) {
      const point = interpolate(start, end, step / steps);
      const previousLng = path[path.length - 1].lng;

      point.lng += 360 * Math.round((previousLng - point.lng) / 360); // Isso aqui é para evitar a linha de atravessar o globo caso a aeronave cruzasse o Oceano Pacífico

      path.push(point);
    }
  }

  return path;
}


// Soma a distância de cada segmento
export function routeDistance(route: RoutePoint[]): number {
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    total += distanceNM(route[i], route[i + 1]);
  }
  return total;
}

// Calcula onde o avião está após X milhas náuticas
export function positionAtDistance(route: RoutePoint[], traveledNM: number) {
  if (!route.length) return { lat: 0, lng: 0, next: "", segment: 0 };

  const traveled = Math.max(0, traveledNM);
  let segmentStart = 0;

  for (let i = 0; i < route.length - 1; i++) {// Percorre segmentos
    const start = route[i];
    const end = route[i + 1];
    const segmentDistance = distanceNM(start, end);
    const segmentEnd = segmentStart + segmentDistance;

    if (segmentDistance > 0 && traveled < segmentEnd) {
      return {
        ...interpolate(start, end, (traveled - segmentStart) / segmentDistance), // Descobre a posição esférica exata
        next: end.ident,
        segment: i + 1
      };
    }
    segmentStart = segmentEnd;
  }

  const destination = route[route.length - 1];
  return {
    lat: destination.lat,
    lng: destination.lng,
    next: "Destino",
    segment: route.length - 1
  };
}
