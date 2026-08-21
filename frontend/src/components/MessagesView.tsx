import { useState } from "react";
import type { Message } from "../types";
import { Markdown } from "./Markdown";
import { Icon } from "./Icon";
import { formatWhen } from "../format";

interface Props {
  messages: Message[];
  operator: string;
  onPost: (body: string) => Promise<void>;
  onRetract: (id: number) => Promise<void>;
  onBack: () => void;
}

export function MessagesView({
  messages,
  operator,
  onPost,
  onRetract,
  onBack,
}: Props) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || !operator) return;
    setBusy(true);
    try {
      await onPost(draft.trim());
      setDraft("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="messages-view">
      <button type="button" className="btn btn--ghost back" onClick={onBack}>
        <Icon name="arrow-left" size={16} />
        Tilbage
      </button>

      <h1>Beskeder</h1>
      <p className="lead">
        Den nyeste besked står øverst på alle fires arbejdsbord, indtil den
        bliver erstattet eller trukket tilbage.
      </p>

      <form className="composer" onSubmit={submit}>
        <label htmlFor="draft">Ny besked</label>
        <textarea
          id="draft"
          rows={4}
          value={draft}
          placeholder="Fx: Ny recept til roefrø ligger klar. Brug den fra i dag."
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="composer__foot">
          <span className="composer__hint">
            Markdown virker. **fed**, lister og links.
          </span>
          <button
            type="submit"
            className="btn"
            disabled={busy || !draft.trim() || !operator}
            title={operator ? undefined : "Skriv dine initialer først"}
          >
            <Icon name="send" size={16} />
            {busy ? "Sender…" : "Slå op"}
          </button>
        </div>
      </form>

      {messages.length === 0 ? (
        <p className="empty">Ingen beskeder endnu.</p>
      ) : (
        <ul className="message-list">
          {messages.map((message, index) => (
            <li key={message.id} className="message">
              <div className="message__meta">
                {index === 0 && (
                  <span className="pill pill--ok">
                    <Icon name="circle-check" size={13} strokeWidth={2.2} />
                    Aktuel
                  </span>
                )}
                <span>
                  {message.author} · {formatWhen(message.created_at)}
                </span>
              </div>
              <div className="message__body">
                <Markdown content={message.body} />
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => onRetract(message.id)}
              >
                <Icon name="trash-2" size={15} />
                Træk tilbage
              </button>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
