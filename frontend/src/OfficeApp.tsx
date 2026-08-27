/**
 * Kontorapplikationen. Alt bag indlogningen.
 *
 * Analytikeren arbejder med instrumentet, ordrekontoret bestemmer hvad der
 * skal køres, og udvikleren ser det hele. De deler skal, menu og indlogning.
 *
 * Produktionsskærmen er en anden applikation, se ProductionApp.tsx. Den deler
 * hverken publikum eller vilkår med den her, og den skal ikke hente wikien og
 * forvirringsmatricen for at vise et bræt.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { navigate, parseHash, type View } from "./routes";
import type {
  ClassifierVersion,
  ConfusionMatrix,
  DailyStatus,
  Dashboard,
  Health,
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
import { LotsView } from "./components/LotsView";
import { OrdersView } from "./components/OrdersView";
import { ScansView } from "./components/ScansView";
import { ScanView } from "./components/ScanView";
import { AnalysisView } from "./components/AnalysisView";
import { Icon } from "./components/Icon";
import { clearOperator, loadOperator, saveOperator } from "./operator";
import { LoginView } from "./components/LoginView";

/**
 * Guiden vises én gang pr. fane, ikke én gang pr. dag.
 *
 * Afvises den, skal den ikke komme igen, mens man arbejder, men den skal
 * komme igen i morgen. sessionStorage er præcis den levetid.
 */
const WIZARD_DISMISSED_KEY = "ubs.wizard.dismissed";

export default function OfficeApp() {
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

  // Rollen afgør ikke bare menuen, men også hvad der overhovedet hentes.
  // Ordrekontoret skal hverken have analytikerens arbejdsbord eller
  // opstartsguiden til instrumentet: den handler om at tænde VideometerLab,
  // og det er ikke deres morgen.
  const me = operators.find(
    (o) => o.initials.toLowerCase() === operator.toLowerCase(),
  );
  const unconfigured = operators.length === 0;
  const showLab = unconfigured || me?.role !== "ordrekontor";

  useEffect(() => {
    if (!operator) return;

    void (async () => {
      setError(null);
      window.scrollTo({ top: 0 });
      // Ordrekontorets forside er ordrebogen. Kun forsiden deles: Beskeder er
      // fælles og skal stadig hentes som alle andre.
      const asked = parseHash(hash);
      const current: View =
        !showLab && asked.name === "home" ? { name: "orders" } : asked;
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
          case "orders":
            // Begge sider henter selv. De deler ikke arbejdsbordets kald.
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

  if (!operator) {
    return <LoginView operators={operators} onChoose={signIn} />;
  }

  // Tre slags arbejde, tre menuer. Analytikeren arbejder med instrumentet,
  // ordrekontoret bestemmer hvad der skal køres, og udvikleren ser det hele.
  // Operatøren ude ved linjen står ikke på listen: produktionsskærmen ligger
  // foran login.
  //
  // Er listen tom, er der ingen at slå op, og så vises alt. Ellers ville
  // applikationen se halvt tom ud, mens nogen er ved at sætte den op, og det
  // ligner en fejl.
  const showAnalysis = unconfigured || me?.role === "udvikler";
  const showOrders =
    unconfigured || me?.role === "ordrekontor" || me?.role === "udvikler";

  // Ordrekontoret lander på ordrebogen og ikke på analytikerens arbejdsbord.
  // Forsiden er den samme adresse for alle, så det er her, de skilles — og
  // det sker inde i skallen, så menuen bliver stående.
  const showOrdersView =
    view.name === "orders" || (!showLab && view.name === "home");

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
          {showLab && (
            <>
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
            </>
          )}

          {showOrders && (
            <button
              type="button"
              className={navClass(view.name === "orders")}
              onClick={() => navigate({ name: "orders" })}
            >
              <Icon name="file-text" />
              Ordrer
            </button>
          )}

          {showLab && (
            <>
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
            </>
          )}

          {/* Beskeder er den fælles kanal og hører til alle tre. Det er der,
              en analytiker skriver, at instrumentet er nede, og det skal
              ordrekontoret også kunne læse. */}
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

        {!loading && view.name === "home" && showLab && dashboard && (
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

        {!loading && showOrdersView && <OrdersView operator={operator} />}

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
