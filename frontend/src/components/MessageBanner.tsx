import type { Message } from "../types";
import { Markdown } from "./Markdown";
import { Icon } from "./Icon";
import { formatWhen } from "../format";

interface Props {
  message: Message | null;
  onOpenMessages: () => void;
}

export function MessageBanner({ message, onOpenMessages }: Props) {
  if (!message) return null;

  return (
    <section className="banner" aria-label="Besked fra udvikleren">
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
  );
}
