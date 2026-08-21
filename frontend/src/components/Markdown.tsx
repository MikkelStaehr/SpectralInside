import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "./Icon";

/**
 * Procedurerne skrives i ren Markdown. Ud over almindelig Markdown forstår vi
 * fremhævede blokke i GitHub-stil:
 *
 *   > [!WARNING]
 *   > Sluk aldrig hardwaren mens softwaren kører.
 *
 * De bliver løftet ud af teksten og vist tydeligt, fordi det er dem, der
 * afgør om en måling kan bruges bagefter.
 */

const ALERTS: Record<
  string,
  { label: string; className: string; icon: string }
> = {
  WARNING: {
    label: "Vigtigt",
    className: "alert alert--warning",
    icon: "triangle-alert",
  },
  CHECK: { label: "Tjek", className: "alert alert--check", icon: "circle-check" },
  NOTE: { label: "Bemærk", className: "alert alert--note", icon: "info" },
  TIP: { label: "Tip", className: "alert alert--note", icon: "info" },
  UDFYLD: {
    label: "Skal udfyldes",
    className: "alert alert--todo",
    icon: "square-pen",
  },
};

type Block =
  | { kind: "markdown"; content: string }
  | { kind: "alert"; type: string; content: string };

const ALERT_OPEN = /^>\s*\[!(\w+)\]\s*$/;

export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const blocks: Block[] = [];
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join("\n").trim();
    if (content) blocks.push({ kind: "markdown", content });
    buffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const opener = ALERT_OPEN.exec(lines[i]);
    if (!opener) {
      buffer.push(lines[i]);
      continue;
    }

    flush();
    const inner: string[] = [];
    let cursor = i + 1;
    while (cursor < lines.length && lines[cursor].startsWith(">")) {
      inner.push(lines[cursor].replace(/^>\s?/, ""));
      cursor += 1;
    }
    blocks.push({
      kind: "alert",
      type: opener[1].toUpperCase(),
      content: inner.join("\n").trim(),
    });
    i = cursor - 1;
  }

  flush();
  return blocks;
}

function Body({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
  );
}

export function Markdown({ content }: { content: string }) {
  if (!content.trim()) return null;

  return (
    <div className="prose">
      {parseBlocks(content).map((block, i) => {
        if (block.kind === "markdown") {
          return <Body key={i} content={block.content} />;
        }
        const alert = ALERTS[block.type] ?? {
          label: block.type,
          className: "alert alert--note",
          icon: "info",
        };
        return (
          <aside key={i} className={alert.className}>
            <p className="alert__label">
              <Icon name={alert.icon} size={14} strokeWidth={2.2} />
              {alert.label}
            </p>
            <Body content={block.content} />
          </aside>
        );
      })}
    </div>
  );
}
