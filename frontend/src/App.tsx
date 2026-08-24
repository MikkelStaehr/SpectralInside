import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type {
  ClassifierVersion,
  ConfusionMatrix,
  DailyStatus,
  Dashboard,
  Health,
  LotSummary,
  MaintenanceStatus,
  Message,
  Operator,
  Procedure,
  ProcedureSummary,
  ScanSummary,
} from "./types";
import { DashboardView } from "./components/DashboardView";
import { WikiView } from "./components/WikiView";
import { MaintenanceView } from "./components/MaintenanceView";
import { ProcedureView } from "./components/ProcedureView";
import { MessagesView } from "./components/MessagesView";
import { OperatorBadge } from "./components/OperatorBadge";
import { StartupWizard } from "./components/StartupWizard";
import { DisplayList, DisplaySampleView } from "./components/DisplayView";
import { OperatorScreen } from "./components/OperatorScreen";
import { SampleView } from "./components/SampleView";
import { LotsView } from "./components/LotsView";
import { ScansView } from "./components/ScansView";
import { ScanView } from "./components/ScanView";
import { AnalysisView } from "./components/AnalysisView";
import { Icon } from "./components/Icon";
import { clearOperator, loadOperator, saveOperator } from "./operator";
import { LoginView } from "./components/LoginView";

type View =
  | { name: "home" }
  | { name: "wiki" }
  | { name: "maintenance" }
  | { name: "procedure"; id: string }
  | { name: "messages" }
  | { name: "scans" }
  | { name: "scan"; id: string }
  | { name: "analysis" }
  | { name: "lots" }
  | { name: "display" }
  | { name: "lotMonitor"; lotNo: string }
  | { name: "lotSample"; sampleId: number }
  | { name: "displaySample"; id: string };

const WIZARD_DISMISSED_KEY = "ubs.wizard.dismissed";

function parseHash(hash: string): View {
  const path = hash.replace(/^#\/?/, "");
  // Billedrækken ligger under lottet i adressen, men er sin egen visning.
  // Den skal derfor testes før den løsere lot-regel nedenunder.
  if (path.startsWith("visning/scanning/"))
    return {
      name: "displaySample",
      id: decodeURIComponent(path.slice("visning/scanning/".length)),
    };
  if (path.startsWith("visning/proeve/"))
    return {
      name: "lotSample",
      sampleId: Number(path.slice("visning/proeve/".length)),
    };
  if (path.startsWith("visning/"))
    return {
      name: "lotMonitor",
      lotNo: decodeURIComponent(path.slice("visning/".length)),
    };
  if (path === "visning") return { name: "display" };
  if (path.startsWith("procedure/"))
    return { name: "procedure", id: path.slice("procedure/".length) };
  if (path.startsWith("scanning/"))
    return { name: "scan", id: decodeURIComponent(path.slice("scanning/".length)) };
  if (path === "scanninger") return { name: "scans" };
  if (path === "lots") return { name: "lots" };
  if (path === "wiki") return { name: "wiki" };
  if (path === "vedligehold") return { name: "maintenance" };
  if (path === "analyse") return { name: "analysis" };
  if (path === "beskeder") return { name: "messages" };
  return { name: "home" };
}

function toHash(view: View): string {
  switch (view.name) {
    case "displaySample":
      return `#/visning/scanning/${encodeURIComponent(view.id)}`;
    case "lotMonitor":
      return `#/visning/${encodeURIComponent(view.lotNo)}`;
    case "lotSample":
      return `#/visning/proeve/${view.sampleId}`;
    case "display":
      return "#/visning";
    case "procedure":
      return `#/procedure/${view.id}`;
    case "scan":
      return `#/scanning/${encodeURIComponent(view.id)}`;
    case "scans":
      return "#/scanninger";
    case "lots":
      return "#/lots";
    case "wiki":
      return "#/wiki";
    case "maintenance":
      return "#/vedligehold";
    case "analysis":
      return "#/analyse";
    case "messages":
      return "#/beskeder";
    default:
      return "#/";
  }
}

export default function App() {
  const [hash, setHash] = useState(() => window.location.hash || "#/");
  const view = parseHash(hash);

  const [operator, setOperator] = useState(() => loadOperator());
  const [operators, setOperators] = useState<Operator[]>([]);

  const [procedures, setProcedures] = useState<ProcedureSummary[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceStatus[]>([]);
  const [daily, setDaily] = useState<DailyStatus[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [openProcedure, setOpenProcedure] = useState<Procedure | null>(null);

  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [openScan, setOpenScan] = useState<ScanSummary | null>(null);
  const [classifiers, setClassifiers] = useState<ClassifierVersion[]>([]);
  const [confusion, setConfusion] = useState<ConfusionMatrix | null>(null);
  const [displayLots, setDisplayLots] = useState<LotSummary[] | null>(null);

  const [wizard, setWizard] = useState<Procedure | null>(null);
  const [wizardBusy, setWizardBusy] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    void api
      .operators()
      .then(setOperators)
      .catch(() => setOperators([]));
  }, []);

  // Operatørvisningen ligger foran login og henter uafhængigt af resten.
  //
  // Listen hentes forfra med jævne mellemrum. Den er landingssiden på en skærm,
  // der står tændt hele dagen, og et nyt resultat, der lander mens nogen kigger
  // på listen, skal kunne ses uden at nogen genindlæser siden. Selve monitoren
  // har sin egen strøm, se lotStream.ts.
  useEffect(() => {
    if (parseHash(hash).name !== "display") return;

    const load = () =>
      void api
        .lots()
        .then(setDisplayLots)
        .catch(() => setDisplayLots([]));

    load();
    const timer = window.setInterval(load, 15_000);
    return () => window.clearInterval(timer);
  }, [hash]);

  const loadShared = useCallback(async () => {
    const [proceduresData, dailyData, healthData] = await Promise.all([
      api.procedures(),
      api.daily(),
      api.health(),
    ]);
    setProcedures(proceduresData);
    setDaily(dailyData);
    setHealth(healthData);
    return dailyData;
  }, []);

  useEffect(() => {
    if (!operator) return;

    void (async () => {
      setError(null);
      window.scrollTo({ top: 0 });
      const current = parseHash(hash);
      const shared = procedures.length === 0 ? loadShared() : Promise.resolve();

      try {
        switch (current.name) {
          case "procedure": {
            setOpenProcedure(null);
            const [procedure] = await Promise.all([
              api.procedure(current.id),
              shared,
            ]);
            setOpenProcedure(procedure);
            break;
          }
          case "maintenance": {
            const [statuses] = await Promise.all([api.maintenance(), shared]);
            setMaintenance(statuses);
            break;
          }
          case "messages": {
            const [list] = await Promise.all([api.messages(), shared]);
            setMessages(list);
            break;
          }
          case "scans":
            await Promise.all([api.scans().then(setScans), shared]);
            break;
          case "scan": {
            setOpenScan(null);
            const [detail] = await Promise.all([api.scan(current.id), shared]);
            setOpenScan(detail);
            break;
          }
          case "analysis": {
            const [, versions, matrix] = await Promise.all([
              api.scans().then(setScans),
              api.classifiers(),
              api.confusion(),
              shared,
            ]);
            setClassifiers(versions);
            setConfusion(matrix);
            break;
          }
          case "wiki":
          // Lots-siden henter selv. Den skal ikke ind i det fælles kald,
          // fordi den er den eneste visning, der både læser og skriver.
          case "lots":
            await shared;
            break;
          default: {
            const [board, dailyData] = await Promise.all([
              api.dashboard(),
              loadShared(),
            ]);
            setDashboard(board);

            const pending = dailyData.find((d) => !d.done);
            const dismissed =
              sessionStorage.getItem(WIZARD_DISMISSED_KEY) ===
              pending?.procedure_id;
            if (pending && !dismissed && !wizard) {
              setWizard(await api.procedure(pending.procedure_id));
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Kunne ikke hente data");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, loadShared, operator]);

  const navigate = (next: View) => {
    const target = toHash(next);
    if (window.location.hash === target) return;
    window.location.hash = target;
  };

  const signIn = (initials: string) => {
    saveOperator(initials);
    setOperator(initials);
  };

  const signOut = () => {
    clearOperator();
    setOperator("");
    setWizard(null);
    setLoading(true);
  };

  const dismissWizard = () => {
    if (wizard) sessionStorage.setItem(WIZARD_DISMISSED_KEY, wizard.id);
    setWizard(null);
  };

  const finishWizard = async () => {
    if (!wizard) return;
    setWizardBusy(true);
    try {
      await api.completeDaily(wizard.id, operator);
      setDaily(await api.daily());
      sessionStorage.removeItem(WIZARD_DISMISSED_KEY);
      setWizard(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke registrere");
    } finally {
      setWizardBusy(false);
    }
  };

  const openWizard = async (procedureId: string) => {
    try {
      sessionStorage.removeItem(WIZARD_DISMISSED_KEY);
      setWizard(await api.procedure(procedureId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke hente guiden");
    }
  };

  const completeMaintenance = async (taskId: string, doneAt: string) => {
    try {
      await api.completeMaintenance(taskId, operator, doneAt);
      setMaintenance(await api.maintenance());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke registrere");
    }
  };

  const refreshMessages = async () => {
    const [list, board] = await Promise.all([api.messages(), api.dashboard()]);
    setMessages(list);
    setDashboard(board);
  };

  const postMessage = async (body: string) => {
    await api.postMessage(body, operator);
    await refreshMessages();
  };

  const retractMessage = async (id: number) => {
    await api.retractMessage(id);
    await refreshMessages();
  };

  const navClass = (active: boolean) =>
    `nav__item${active ? " nav__item--active" : ""}`;

  if (view.name === "display") {
    return (
      <DisplayList
        lots={displayLots ?? []}
        onOpen={(lotNo) => navigate({ name: "lotMonitor", lotNo })}
      />
    );
  }

  if (view.name === "lotMonitor") {
    return (
      <OperatorScreen
        lotNo={view.lotNo}
        onBack={() => navigate({ name: "display" })}
        onOpenSample={(sampleId) => navigate({ name: "lotSample", sampleId })}
      />
    );
  }

  if (view.name === "lotSample") {
    return (
      <SampleView
        key={view.sampleId}
        sampleId={view.sampleId}
        // Tilbage til det lot, prøven hører til. Visningen kender lotnummeret
        // først når den har hentet prøven, så browserens egen historik er den
        // rigtige vej hjem.
        onBack={() => window.history.back()}
      />
    );
  }

  if (view.name === "displaySample") {
    return (
      <DisplaySampleView
        key={view.id}
        scanId={view.id}
        // Tilbage til det lot, man kom fra. Visningen kender ikke lotnummeret,
        // og den nås kun ved et klik derindefra, så browserens egen historik
        // er den rigtige vej hjem.
        onBack={() => window.history.back()}
      />
    );
  }

  if (!operator) {
    return <LoginView operators={operators} onChoose={signIn} />;
  }

  const me = operators.find(
    (o) => o.initials.toLowerCase() === operator.toLowerCase(),
  );
  const showAnalysis = operators.length === 0 || me?.role === "udvikler";
  const openProcedureView = (id: string) => navigate({ name: "procedure", id });

  return (
    <div className="shell">
      <aside className="sidebar">
        <div>
          <img className="logo logo--light" src="/ubs-logo.png" alt="UBS" />
          <img
            className="logo logo--dark"
            src="/ubs-logo-white.png"
            alt=""
            aria-hidden="true"
          />
          <p className="wordmark">
            <span className="wordmark__name">Spectral Inside</span>
            <span className="wordmark__sub">Analyserum · VideometerLab</span>
          </p>
        </div>

        <nav className="nav" aria-label="Hovedmenu">
          <button
            type="button"
            className={navClass(view.name === "home")}
            onClick={() => navigate({ name: "home" })}
          >
            <Icon name="layout-dashboard" />
            Arbejdsbord
          </button>

          <button
            type="button"
            className={navClass(
              view.name === "scans" || view.name === "scan",
            )}
            onClick={() => navigate({ name: "scans" })}
          >
            <Icon name="scan-line" />
            Scanninger
          </button>

          <button
            type="button"
            className={navClass(view.name === "lots")}
            onClick={() => navigate({ name: "lots" })}
          >
            <Icon name="badge-check" />
            Lots
          </button>

          <button
            type="button"
            className={navClass(view.name === "wiki")}
            onClick={() => navigate({ name: "wiki" })}
          >
            <Icon name="book-open" />
            Wiki
          </button>

          <button
            type="button"
            className={navClass(view.name === "maintenance")}
            onClick={() => navigate({ name: "maintenance" })}
          >
            <Icon name="wrench" />
            Vedligehold
          </button>

          <button
            type="button"
            className={navClass(view.name === "messages")}
            onClick={() => navigate({ name: "messages" })}
          >
            <Icon name="message-square" />
            Beskeder
          </button>

          {showAnalysis && (
            <>
              <p className="nav__label nav__label--divider">Analyse</p>
              <button
                type="button"
                className={navClass(view.name === "analysis")}
                onClick={() => navigate({ name: "analysis" })}
              >
                <Icon name="target" />
                Modeller og materiale
              </button>
            </>
          )}
        </nav>

        <div className="sidebar__foot">
          <OperatorBadge operator={operator} onSwitch={signOut} />
        </div>
      </aside>

      <main className="main">
        {error && (
          <div className="alert alert--warning banner-wide" role="alert">
            <p className="alert__label">
              <Icon name="triangle-alert" size={14} strokeWidth={2.2} />
              Der er noget galt
            </p>
            <p>{error}</p>
          </div>
        )}

        {health?.status === "degraded" && (
          <div className="alert alert--todo banner-wide">
            <p className="alert__label">Problemer i indholdet</p>
            <ul>
              {health.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        )}

        {loading && <p className="empty">Henter…</p>}

        {!loading && view.name === "home" && dashboard && (
          <DashboardView
            data={dashboard}
            daily={daily}
            onOpenMaintenance={() => navigate({ name: "maintenance" })}
            onOpenMessages={() => navigate({ name: "messages" })}
            onOpenScan={(id) => navigate({ name: "scan", id })}
            onOpenScans={() => navigate({ name: "scans" })}
            onOpenWizard={openWizard}
          />
        )}

        {!loading && view.name === "wiki" && (
          <WikiView procedures={procedures} onOpen={openProcedureView} />
        )}

        {!loading && view.name === "maintenance" && (
          <MaintenanceView
            statuses={maintenance}
            procedures={procedures}
            operator={operator}
            onComplete={completeMaintenance}
            onOpenProcedure={openProcedureView}
          />
        )}

        {!loading && view.name === "scans" && (
          <ScansView
            scans={scans}
            onOpen={(id) => navigate({ name: "scan", id })}
          />
        )}

        {view.name === "scan" &&
          (openScan ? (
            <ScanView
              key={openScan.id}
              scan={openScan}
              onBack={() => navigate({ name: "scans" })}
            />
          ) : (
            !error && <p className="empty">Henter scanningen…</p>
          ))}

        {!loading && view.name === "lots" && (
          <LotsView
            operator={operator}
            onOpenMonitor={(lotNo) => navigate({ name: "lotMonitor", lotNo })}
          />
        )}

        {!loading && view.name === "analysis" && (
          <AnalysisView
            classifiers={classifiers}
            confusion={confusion}
            scans={scans}
            onOpenScan={(id) => navigate({ name: "scan", id })}
          />
        )}

        {view.name === "procedure" &&
          (openProcedure ? (
            <ProcedureView
              key={openProcedure.id}
              procedure={openProcedure}
              onBack={() =>
                navigate({
                  name:
                    openProcedure.category === "vedligehold"
                      ? "maintenance"
                      : "wiki",
                })
              }
            />
          ) : (
            !error && <p className="empty">Henter proceduren…</p>
          ))}

        {view.name === "messages" && (
          <MessagesView
            messages={messages}
            operator={operator}
            onPost={postMessage}
            onRetract={retractMessage}
            onBack={() => navigate({ name: "home" })}
          />
        )}
      </main>

      {wizard && (
        <StartupWizard
          procedure={wizard}
          busy={wizardBusy}
          onFinish={finishWizard}
          onDismiss={dismissWizard}
        />
      )}
    </div>
  );
}
