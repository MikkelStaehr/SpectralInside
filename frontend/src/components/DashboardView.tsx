import type { Dashboard, DailyStatus } from "../types";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { formatDate, formatWhen } from "../format";

interface Props {
  data: Dashboard;
  daily: DailyStatus[];
  onOpenMaintenance: () => void;
  onOpenMessages: () => void;
  onOpenScan: (id: string) => void;
  onOpenScans: () => void;
  onOpenWizard: (id: string) => void;
}

/**
 * Påmindelsen om vedligehold.
 *
 * Over tid, forfalder snart og aldrig registreret er tre forskellige ting, og
 * de skal ikke se ens ud. Rød betyder at noget er skredet. Gul betyder at
 * noget nærmer sig eller er ukendt. Slås de sammen til "kræver handling",
 * kan man ikke se om det haster.
 */
function maintenanceNotice(reminder: {
  overdue: number;
  due_soon: number;
  never: number;
  titles: string[];
}) {
  const names = reminder.titles.slice(0, 3).join(", ");
  const more = reminder.titles.length > 3 ? " med flere" : "";
  const plural = (n: number, one: string, many: string) =>
    n === 1 ? `1 ${one}` : `${n} ${many}`;

  if (reminder.overdue > 0) {
    return {
      tone: "overdue" as const,
      icon: "circle-alert",
      lead: plural(reminder.overdue, "opgave er", "opgaver er") + " over tid",
      rest: `: ${names}${more}`,
    };
  }

  if (reminder.due_soon > 0) {
    return {
      tone: "soon" as const,
      icon: "clock",
      lead:
        plural(reminder.due_soon, "opgave forfalder", "opgaver forfalder") +
        " snart",
      rest: `: ${names}${more}`,
    };
  }

  return {
    tone: "soon" as const,
    icon: "calendar-clock",
    lead:
      plural(reminder.never, "opgave er", "opgaver er") + " aldrig registreret",
    rest: `: ${names}${more}. Der er ingen historik at regne forfald ud fra`,
  };
}

export function DashboardView({
  data,
  daily,
  onOpenMaintenance,
  onOpenMessages,
  onOpenScan,
  onOpenScans,
  onOpenWizard,
}: Props) {
  const { reminder, scans, recent, message } = data;
  const needsAction = reminder.overdue + reminder.due_soon + reminder.never;
  const notice = maintenanceNotice(reminder);
  const pendingDaily = daily.filter((d) => !d.done);

  return (
    <div className="board">
      <header className="page-head">
        <h1>Arbejdsbord</h1>
      </header>

      {/* Påmindelser øverst. De vises kun, når der faktisk er noget. */}
      {pendingDaily.map((item) => (
        <button
          key={item.procedure_id}
          type="button"
          className="notice notice--todo"
          onClick={() => onOpenWizard(item.procedure_id)}
        >
          <Icon name="power" size={20} />
          <span className="notice__text">
            <strong>{item.title}</strong> er ikke kørt i dag
          </span>
          <span className="notice__action">Start guiden</span>
          <Icon name="chevron-right" size={17} />
        </button>
      ))}

      {needsAction > 0 && (
        <button
          type="button"
          className={`notice notice--${notice.tone}`}
          onClick={onOpenMaintenance}
        >
          <Icon name={notice.icon} size={20} />
          <span className="notice__text">
            <strong>{notice.lead}</strong>
            {notice.rest}
          </span>
          <span className="notice__action">Se vedligehold</span>
          <Icon name="chevron-right" size={17} />
        </button>
      )}

      {message && (
        <section className="banner" aria-label="Besked">
          <div className="banner__meta">
            <span className="banner__tag">
              <Icon name="message-square" size={13} strokeWidth={2.2} />
              Besked
            </span>
            <span className="banner__by">
              {message.author} · {formatWhen(message.created_at)}
            </span>
          </div>
          <div className="banner__body">
            <Markdown content={message.body} />
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={onOpenMessages}
          >
            Tidligere beskeder
            <Icon name="chevron-right" size={15} />
          </button>
        </section>
      )}

      <section className="panel">
        <header className="panel__head">
          <h2>Scanninger</h2>
        </header>
        <div className="counts__grid">
          <div className="counts__item counts__item--lead">
            <span className="counts__number">{scans.yesterday}</span>
            <span className="counts__label">i går</span>
          </div>
          <div className="counts__item">
            <span className="counts__number">{scans.today}</span>
            <span className="counts__label">i dag</span>
          </div>
          <div className="counts__item">
            <span className="counts__number">{scans.last_7_days}</span>
            <span className="counts__label">sidste 7 dage</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <header className="panel__head panel__head--split">
          <div>
            <h2>Seneste scanninger</h2>
            <p className="panel__sub">Opskrift, lot, analytiker og dato.</p>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={onOpenScans}
          >
            Alle scanninger
            <Icon name="chevron-right" size={15} />
          </button>
        </header>

        {recent.length === 0 ? (
          <p className="empty" style={{ padding: "18px 22px" }}>
            Ingen scanninger fundet.
          </p>
        ) : (
          <table className="recent">
            <thead>
              <tr>
                <th>Opskrift</th>
                <th>Lot</th>
                <th>Analytiker</th>
                <th>Dato</th>
                <th className="recent__num">Frø</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recent.map((scan) => (
                <tr key={scan.id} onClick={() => onOpenScan(scan.id)}>
                  <td>
                    <span className="chip">{scan.recipe ?? "ukendt"}</span>
                  </td>
                  <td className="recent__lot">{scan.sample ?? scan.id}</td>
                  <td>{scan.operator ?? "?"}</td>
                  <td>
                    {scan.scanned_on ? formatDate(scan.scanned_on) : "ukendt"}
                  </td>
                  <td className="recent__num">
                    {scan.blob_count.toLocaleString("da-DK")}
                  </td>
                  <td className="recent__num">
                    <Icon name="chevron-right" size={16} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
