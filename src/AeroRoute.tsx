"use dom";

// IMPORTS NECESSÁRIOS
import {
    useEffect, // executar efeito colateral (algo que sai do fluxo, tipo registrar evento, buscar dado, mexer com API etc...)
    useMemo, // memoriza valores derivados
    useRef, // é uma referência mutável que não provoca renderização quando muda
    useState // armazenar estado (ex. const [speed, setSpeed] = useState(450);)
} from "react";

// IMPORTS QUE VEM DO GEO.TS
import {
    Airport, // type
    RoutePoint, // type
    Waypoint, // type
    buildRoutePath, // func
    generateRoute, // func
    positionAtDistance, // func
    routeDistance // func
} from "./geo";

import airportsData from "../public/airports.json";
import waypointsData from "../public/waypoints.json";
import "./AeroRoute.css";

const airports: Airport[] = airportsData;
const waypoints: Waypoint[] = waypointsData;
const publicBaseUrl = (process.env.EXPO_BASE_URL || "/").replace(/\/?$/, "/");

type AeroRouteProps = {
  dom?: import("expo/dom").DOMProps;
  isActive: boolean;
  onCopyRoute: (text: string) => Promise<boolean>;
};

function formatMinutes(value: number) {
  const minutes = Math.max(0, Math.round(value));

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return (
    `${hours}h ${String(remainingMinutes).padStart(2, "0")}min`
  );
}

export default function AeroRoute({ isActive, onCopyRoute }: AeroRouteProps) {
  // Campos do formulário.
  const [originCode, setOriginCode] =
    useState("SBGR");

  const [destinationCode, setDestinationCode] =
    useState("EGLL");

  // Rota e simulação.
  const [route, setRoute] =
    useState<RoutePoint[]>([]);





  // progresso (quanto foi percorrido em milhas náuticas (NM))
  const [traveledNM, setTraveledNM] =
    useState(0);
  const traveledNMRef = useRef(0);

  const [speed, setSpeed] =
    useState(450); // em knots ~883Km/h

  const [timeFactor, setTimeFactor] =
    useState(60);

  const [playing, setPlaying] =
    useState(false);

  // Interrompe a simulação quando o app nativo entra em segundo plano.
  if (!isActive && playing) setPlaying(false);

  const [followAircraft, setFollowAircraft] =
    useState(false);






  // Comunicação com o globo. (Usa o elemento IFrame)
  const iframeRef =
    useRef<HTMLIFrameElement>(null);

  // Valida se o globo terminou de renderizar
  const [globeReady, setGlobeReady] =
    useState(false);

  const [status, setStatus] =
    useState(`${airports.length} aeroportos e ${waypoints.length} waypoints carregados.`);
  // Enviar comandos do React para o globo.
  function sendToGlobe(
    type: string,
    payload: Record<string, unknown> = {}
  ) {
    // pra não crashar a aplicação, basicametne verifica se existe iframeRef
    iframeRef.current?.contentWindow?.postMessage(
      {
        type,
        ...payload
      },
      window.location.protocol === "file:" ? "*" : window.location.origin
    );
  }



  // Receber a confirmação de carregamento do globo.
  useEffect(() => {
    function receiveMessage(event: MessageEvent) {
      if (
        (window.location.protocol !== "file:" && event.origin !== window.location.origin) ||
        event.source !== iframeRef.current?.contentWindow
      ) {
        return;
      }

      const message = event.data;

      if (message?.type === "READY") {
        setGlobeReady(true);
      }

      if (message?.type === "ERROR") {
        setStatus(
          message.message ||
          "Erro ao inicializar o globo."
        );
      }
    }

    window.addEventListener(
      "message",
      receiveMessage
    );

    return () => {
      window.removeEventListener(
        "message",
        receiveMessage
      );
    };
  }, []);



  useEffect(() => {
    function pauseWhenHidden() {
      if (document.hidden) setPlaying(false);
    }
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => document.removeEventListener("visibilitychange", pauseWhenHidden);
  }, []);



  // Gerar uma nova rota.
  function handleGenerateRoute() {
    const origin = airports.find(
      airport =>
        airport.code ===
        originCode.trim().toUpperCase()
    );

    const destination = airports.find(
      airport =>
        airport.code ===
        destinationCode.trim().toUpperCase()
    );

    if (!origin || !destination) {
      setStatus(
        "ICAO não encontrado. Verifique os " +
        "aeroportos de origem e destino."
      );

      return;
    }

    if (origin.code === destination.code) {
      setStatus(
        "A origem e o destino devem ser diferentes."
      );

      return;
    }

    setPlaying(false);
    setTraveledNM(0);
    traveledNMRef.current = 0;

    // Chama a função generateRoute
    const generatedRoute = generateRoute(
      origin,
      destination,
      waypoints
    );

    setRoute(generatedRoute); // set

    const fixes = generatedRoute.filter(point => point.type === "fix").length;
    const coordinates = generatedRoute.filter(point => point.type === "coordinate").length;

    setStatus(
      fixes + coordinates > 0
        ? `Rota gerada: ${fixes} fix(es) da base e ${coordinates} ponto(s) por coordenadas.`
        : "Rota direta gerada. Nenhum waypoint " +
          "adequado foi encontrado para este trajeto."
    );
  }



  // Calcular a distância total da rota.
  const totalDistance = useMemo(() => {
    return routeDistance(route);
  }, [route]);

  const routePath = useMemo(() => buildRoutePath(route), [route]);



  // Calcular a posição atual da aeronave.
  const aircraftPosition = useMemo(() => {
    return positionAtDistance(
      route,
      traveledNM
    );
  }, [route, traveledNM]);




  // Atualizar o trajeto (rota) desenhado no globo.
  useEffect(() => {
    if (!globeReady || route.length < 2) {
      return;
    }

    sendToGlobe("ROUTE", {
      points: route,
      path: routePath
    });
  }, [globeReady, route, routePath]);




  // Atualizar a posição da aeronave no globo.
  useEffect(() => {
    if (!globeReady || route.length < 2) {
      return;
    }

    sendToGlobe("AIRCRAFT", {
      lat: aircraftPosition.lat,
      lng: aircraftPosition.lng,
      ahead: positionAtDistance(route, Math.min(totalDistance, traveledNM + 1)), // Isso vai um pouco a frente para calcular a direção do avião
      follow: followAircraft
    });
  }, [
    globeReady,
    route,
    aircraftPosition.lat,
    aircraftPosition.lng,
    totalDistance,
    traveledNM,
    followAircraft
  ]);

  // Executar o relógio da simulação.
  useEffect(() => {
    if (
      !playing || !isActive ||
      totalDistance <= 0
    ) {
      return;
    }

    let lastUpdate = performance.now();

    const interval = window.setInterval(() => {
      if (document.hidden) {
        setPlaying(false);
        return;
      }
      const now = performance.now();

      const deltaSeconds =
        (now - lastUpdate) / 1000; // Converte milissegundos em segundos

      lastUpdate = now;

      // distancia = velocidade * tempo
      const distanceIncrement =
        speed *
        timeFactor *
        (deltaSeconds / 3600); // 1 hora = 3600 segundos

      // Impede o avião de ultrapassar o destino
      const nextDistance = Math.min(
        totalDistance,
        traveledNMRef.current + distanceIncrement
      );


      traveledNMRef.current = nextDistance; // Valor mutável para o loop
      setTraveledNM(nextDistance); // Atualiza a interface


      // Chegada
      if (nextDistance >= totalDistance) {
        window.clearInterval(interval);
        setPlaying(false);
        setStatus("A aeronave chegou ao destino.");
      }
    }, 100);

    // Limpa o timer
    return () => {
      window.clearInterval(interval);
    };
  }, [
    playing,
    isActive,
    speed,
    timeFactor,
    totalDistance
  ]);

  function handleStartPause() {
    if (route.length < 2 || !globeReady) {
      return;
    }

    if (
      !playing &&
      traveledNM >= totalDistance
    ) {
      setTraveledNM(0);
      traveledNMRef.current = 0;
    }

    setPlaying(previous => !previous);
  }

  function handleReset() {
    setPlaying(false);
    setTraveledNM(0);
    traveledNMRef.current = 0;

    setStatus(
      "Simulação reiniciada."
    );
  }

  function handleOverview() {
    setFollowAircraft(false);

    sendToGlobe("OVERVIEW");
  }

  // Copia para area de transferência
  async function handleCopyRoute() {
    if (!route.length) return;

    const text = [
      "AEROROUTE 3D - PLANO DE VOO",
      "",
      `Origem: ${route[0].ident}`,
      `Destino: ${route[route.length - 1].ident}`,
      "",
      `Rota: ${route.map(p => p.ident).join(" → ")}`,
      "Coordenadas calculadas: " + (
        route.filter(p => p.type === "coordinate").map(p => p.ident).join(" → ") || "nenhuma"
      ),
      "",
      `Distância: ${totalDistance.toFixed(1)} NM`,
      `Velocidade: ${speed} kt`,
      `Duração estimada: ${
        formatMinutes(totalDistance / speed * 60)
      }`,
      "",
    ].join("\n");

    try {
      const copied = await onCopyRoute(text);
      if (!copied) throw new Error("Falha ao copiar o plano.");

      setStatus(
        "Resumo da rota copiado para a área de transferência."
      );
    } catch {
      setStatus(
        "Não foi possível copiar o plano de voo."
      );
    }
  }

  // Indicadores do voo.
  // Percentual = percorrido / total * 100
  const progress = totalDistance > 0
    ? Math.min(
        100,
        (traveledNM / totalDistance) * 100
      )
    : 0;

  const remainingDistance = Math.max(
    0,
    totalDistance - traveledNM
  );

  const estimatedDuration =
    totalDistance / speed * 60; // (O * 60 é para gerar horas)

  const remainingDuration =
    remainingDistance / speed * 60;

  return (
    <div className="ar-root">
      <header className="ar-header">
        <div>
          <h1>AeroRoute 3D</h1>
        </div>
      </header>

      <main className="ar-main">
        <aside className="ar-sidebar">
          <section className="ar-panel">
            <h2>Planejamento de voo</h2>

            <form
              onSubmit={event => {
                event.preventDefault();
                handleGenerateRoute();
              }}
            >
              <div className="ar-field">
                <label htmlFor="origin">
                  Aeroporto de origem
                </label>

                <input
                  id="origin"
                  type="text"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={4}
                  value={originCode}
                  placeholder="Ex.: SBGR"
                  onChange={event =>
                    setOriginCode(
                      event.target.value.toUpperCase()
                    )
                  }
                />
              </div>

              <div className="ar-field">
                <label htmlFor="destination">
                  Aeroporto de destino
                </label>

                <input
                  id="destination"
                  type="text"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={4}
                  value={destinationCode}
                  placeholder="Ex.: SBGL"
                  onChange={event =>
                    setDestinationCode(
                      event.target.value.toUpperCase()
                    )
                  }
                />
              </div>

              <button
                type="submit"
                className="ar-button ar-primary ar-full"
                disabled={
                  !globeReady ||
                  airports.length === 0
                }
              >
                Gerar plano de voo
              </button>
            </form>

            <p className="ar-status" role="status">
              {status}
            </p>

            {/* <p className="ar-note">
              Globo: {
                globeReady
                  ? "pronto"
                  : "carregando..."
              }
            </p> */}
          </section>

          <section className="ar-panel">
            <h2>Controles da simulação</h2>

            <div className="ar-field">
              <label htmlFor="speed">
                Velocidade da aeronave
              </label>

              <select
                id="speed"
                value={speed}
                onChange={event =>
                  setSpeed(Number(event.target.value))
                }
              >
                <option value={150}>150 kt</option>
                <option value={250}>250 kt</option>
                <option value={450}>450 kt</option>
                <option value={850}>850 kt</option>
                <option value={1177}>Mach 2.2 (Concorde)</option>
                <option value={1836}>Mach 3.2 (Lockheed SR-71 Blackbird)</option>
              </select>
            </div>

            <div className="ar-field">
              <label htmlFor="timeFactor">
                Aceleração do tempo
              </label>

              <select
                id="timeFactor"
                value={timeFactor}
                onChange={event =>
                  setTimeFactor(
                    Number(event.target.value)
                  )
                }
              >
                <option value={1}>1×</option>
                <option value={10}>10×</option>
                <option value={60}>60×</option>
                <option value={120}>120×</option>
                <option value={240}>240×</option>
                <option value={480}>480×</option>
              </select>
            </div>

            <div className="ar-buttons">
              <button
                type="button"
                className="ar-button ar-success"
                disabled={route.length < 2}
                onClick={handleStartPause}
              >
                {playing ? "Pausar" : "Iniciar voo"}
              </button>

              <button
                type="button"
                className="ar-button"
                disabled={route.length < 2}
                onClick={handleReset}
              >
                Reiniciar
              </button>
            </div>

            <div
              className="ar-progress"
              role="progressbar"
              aria-valuenow={Math.round(progress)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="ar-progress-bar"
                style={{
                  width: `${progress}%`
                }}
              />
            </div>

            <div className="ar-stats">
              <div className="ar-stat">
                <span>PROGRESSO</span>
                <strong>
                  {progress.toFixed(1)}%
                </strong>
              </div>

              <div className="ar-stat">
                <span>DISTÂNCIA TOTAL</span>
                <strong>
                  {totalDistance.toFixed(1)} NM
                </strong>
              </div>

              <div className="ar-stat">
                <span>DISTÂNCIA RESTANTE</span>
                <strong>
                  {remainingDistance.toFixed(1)} NM
                </strong>
              </div>

              <div className="ar-stat">
                <span>TEMPO RESTANTE</span>
                <strong>
                  {formatMinutes(remainingDuration)}
                </strong>
              </div>

              <div className="ar-stat">
                <span>DURAÇÃO ESTIMADA</span>
                <strong>
                  {formatMinutes(estimatedDuration)}
                </strong>
              </div>

              <div className="ar-stat">
                <span>PRÓXIMO PONTO</span>
                <strong>
                  {route.length
                    ? aircraftPosition.next
                    : "—"}
                </strong>
              </div>
            </div>
          </section>

          {route.length > 0 && (
            <section className="ar-panel">
              <h2>Pontos da rota ({route.length})</h2>
              <ol className="ar-route-list">
                {route.map((point, index) => ( // Iterando pelos waypoints
                  <li key={`${index}:${point.ident}`}>
                    <strong>{point.ident}</strong>
                    <span className="ar-route-kind">
                      {point.type === "airport" ? "Aeroporto" :
                        point.type === "fix" ? "Fix da base" : "Coordenada calculada"}
                    </span>
                  </li>
                ))}
              </ol>
              <button
                type="button"
                className="ar-button ar-full"
                onClick={handleCopyRoute}
              >
                Copiar plano de voo
              </button>
            </section>
          )}

          <section className="ar-panel">
            <h2>Visualização</h2>

            <div className="ar-buttons">
              <button
                type="button"
                className="ar-button"
                onClick={() =>
                  setFollowAircraft(previous => !previous)
                }
              >
                {followAircraft
                  ? "Desativar câmera"
                  : "Seguir avião"}
              </button>

              <button
                type="button"
                className="ar-button"
                onClick={handleOverview}
                disabled={route.length < 2}
              >
                Visão geral
              </button>
            </div>
          </section>
        </aside>


        {/* IFrame para puxar o globe.html */}
        <section className="ar-globe-area">
          <iframe
            ref={iframeRef}
            src={`${publicBaseUrl}globe.html`}
            title="Globo terrestre interativo"
            className="ar-globe"
          />

          {/* <div className="ar-globe-label">
            {route.length > 0
              ? `${route[0].ident} → ${
                  route[route.length - 1].ident
                }`
              : "Selecione dois aeroportos"}
          </div> */}
        </section>


      </main>
    </div>
  );
}
