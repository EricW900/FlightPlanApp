
import {
    useEffect,
    useMemo,
    useRef,
    useState
} from "react";

import {
    Airport,
    RoutePoint,
    Waypoint,
    generateRoute,
    positionAtDistance,
    routeDistance
} from "./geo";

import "./AeroRoute.css";

function formatMinutes(value: number) {
  const minutes = Math.max(0, Math.round(value));

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return (
    `${hours}h ${String(remainingMinutes).padStart(2, "0")}min`
  );
}

export default function AeroRoute() {
  // Dados dos aeroportos e waypoints.
  const [airports, setAirports] =
    useState<Airport[]>([]);

  const [waypoints, setWaypoints] =
    useState<Waypoint[]>([]);

  // Campos do formulário.
  const [originCode, setOriginCode] =
    useState("SBGR");

  const [destinationCode, setDestinationCode] =
    useState("SBGL");

  // Rota e simulação.
  const [route, setRoute] =
    useState<RoutePoint[]>([]);

  const [traveledNM, setTraveledNM] =
    useState(0);

  const [speed, setSpeed] =
    useState(450);

  const [timeFactor, setTimeFactor] =
    useState(60);

  const [playing, setPlaying] =
    useState(false);

  const [followAircraft, setFollowAircraft] =
    useState(false);

  // Comunicação com o globo.
  const iframeRef =
    useRef<HTMLIFrameElement>(null);

  const [globeReady, setGlobeReady] =
    useState(false);

  // Estados da interface.
  const [loading, setLoading] =
    useState(true);

  const [status, setStatus] =
    useState("Carregando aeroportos e waypoints...");

  // Carregar os arquivos JSON.
  useEffect(() => {
    const controller = new AbortController();

    async function loadData() {
      try {
        const [airportsResponse, waypointsResponse] =
          await Promise.all([
            fetch("/airports.json", {
              signal: controller.signal
            }),

            fetch("/waypoints.json", {
              signal: controller.signal
            })
          ]);

        if (
          !airportsResponse.ok ||
          !waypointsResponse.ok
        ) {
          throw new Error(
            "Não foi possível carregar os arquivos JSON."
          );
        }

        const airportsData: Airport[] =
          await airportsResponse.json();

        const waypointsData: Waypoint[] =
          await waypointsResponse.json();

        if (controller.signal.aborted) return;

        if (
          !Array.isArray(airportsData) ||
          !Array.isArray(waypointsData)
        ) {
          throw new Error(
            "Os arquivos JSON possuem formato inválido."
          );
        }

        setAirports(airportsData);
        setWaypoints(waypointsData);

        setStatus(
          `${airportsData.length} aeroportos e ` +
          `${waypointsData.length} waypoints carregados.`
        );

        setLoading(false);
      } catch (error) {
        if (controller.signal.aborted) return;

        console.error(error);

        setStatus(
          "Erro ao carregar os dados. " +
          "Verifique os arquivos da pasta public."
        );

        setLoading(false);
      }
    }

    loadData();

    return () => controller.abort();
  }, []);

  // Enviar comandos do React para o globo.
  function sendToGlobe(
    type: string,
    payload: Record<string, unknown> = {}
  ) {
    iframeRef.current?.contentWindow?.postMessage(
      {
        type,
        ...payload
      },
      window.location.origin
    );
  }

  // Receber a confirmação de carregamento do globo.
  useEffect(() => {
    function receiveMessage(event: MessageEvent) {
      if (
        event.origin !== window.location.origin ||
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

    const generatedRoute = generateRoute(
      origin,
      destination,
      waypoints
    );

    setRoute(generatedRoute);

    const fixes = generatedRoute.length - 2;

    setStatus(
      fixes > 0
        ? `Rota gerada com ${fixes} waypoint(s) intermediário(s).`
        : "Rota direta gerada. Nenhum waypoint " +
          "adequado foi encontrado para este trajeto."
    );
  }

  // Calcular a distância total da rota.
  const totalDistance = useMemo(() => {
    return routeDistance(route);
  }, [route]);

  // Calcular a posição atual da aeronave.
  const aircraftPosition = useMemo(() => {
    return positionAtDistance(
      route,
      traveledNM
    );
  }, [route, traveledNM]);

  // Atualizar o trajeto desenhado no globo.
  useEffect(() => {
    if (!globeReady || route.length < 2) {
      return;
    }

    sendToGlobe("ROUTE", {
      points: route
    });
  }, [globeReady, route]);

  // Atualizar a posição da aeronave no globo.
  useEffect(() => {
    if (!globeReady || route.length < 2) {
      return;
    }

    sendToGlobe("AIRCRAFT", {
      lat: aircraftPosition.lat,
      lng: aircraftPosition.lng,
      follow: followAircraft
    });
  }, [
    globeReady,
    route,
    aircraftPosition.lat,
    aircraftPosition.lng,
    followAircraft
  ]);

  // Executar o relógio da simulação.
  useEffect(() => {
    if (
      !playing ||
      totalDistance <= 0
    ) {
      return;
    }

    let lastUpdate = performance.now();

    const interval = window.setInterval(() => {
      const now = performance.now();

      const deltaSeconds =
        (now - lastUpdate) / 1000;

      lastUpdate = now;

      const distanceIncrement =
        speed *
        timeFactor *
        (deltaSeconds / 3600);

      setTraveledNM(previous =>
        Math.min(
          totalDistance,
          previous + distanceIncrement
        )
      );
    }, 100);

    return () => {
      window.clearInterval(interval);
    };
  }, [
    playing,
    speed,
    timeFactor,
    totalDistance
  ]);

  // Encerrar a simulação ao chegar ao destino.
  useEffect(() => {
    if (
      playing &&
      totalDistance > 0 &&
      traveledNM >= totalDistance
    ) {
      setPlaying(false);
      setStatus("A aeronave chegou ao destino.");
    }
  }, [
    playing,
    traveledNM,
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
    }

    setPlaying(previous => !previous);
  }

  function handleReset() {
    setPlaying(false);
    setTraveledNM(0);

    setStatus(
      "Simulação reiniciada. " +
      "A aeronave voltou para a origem."
    );
  }

  function handleOverview() {
    setFollowAircraft(false);

    sendToGlobe("OVERVIEW");
  }

  async function handleCopyRoute() {
    if (!route.length) return;

    const text = [
      "AEROROUTE 3D - PLANO SIMULADO",
      "",
      `Origem: ${route[0].ident}`,
      `Destino: ${route[route.length - 1].ident}`,
      "",
      `Rota: ${route.map(p => p.ident).join(" → ")}`,
      "",
      `Distância: ${totalDistance.toFixed(1)} NM`,
      `Velocidade: ${speed} kt`,
      `Duração estimada: ${
        formatMinutes(totalDistance / speed * 60)
      }`,
      "",
      "Somente para simulação."
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);

      setStatus(
        "Resumo da rota copiado para a área de transferência."
      );
    } catch {
      setStatus(
        "Não foi possível copiar o plano neste navegador."
      );
    }
  }

  // Indicadores do voo.
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
    totalDistance / speed * 60;

  const remainingDuration =
    remainingDistance / speed * 60;

  return (
    <div className="ar-root">
      <header className="ar-header">
        <div>
          <h1>AeroRoute 3D</h1>

          <span>
            Planejamento e simulação de voo
          </span>
        </div>

        <span>EXPO WEB</span>
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
                  loading ||
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

            <p className="ar-note">
              Globo: {
                globeReady
                  ? "pronto"
                  : "carregando..."
              }
            </p>
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

        <section className="ar-globe-area">
          <iframe
            ref={iframeRef}
            src="/globe.html"
            title="Globo terrestre interativo"
            className="ar-globe"
          />

          <div className="ar-globe-label">
            {route.length > 0
              ? `${route[0].ident} → ${
                  route[route.length - 1].ident
                }`
              : "Selecione dois aeroportos"}
          </div>
        </section>
      </main>
    </div>
  );
}