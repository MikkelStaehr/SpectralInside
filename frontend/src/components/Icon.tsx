import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  FileText,
  Info,
  LayoutDashboard,
  LifeBuoy,
  MessageSquare,
  Moon,
  Power,
  RotateCcw,
  ScanLine,
  Send,
  Sparkles,
  SquarePen,
  Target,
  Trash2,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * Ikonnavne skrives i kebab-case, som lucide selv bruger dem. Procedurerne
 * vælger deres eget ikon i frontmatter (`icon: scan-line`), så nye
 * arbejdsgange kan få et passende ikon uden ændringer i koden. Ukendte navne
 * falder tilbage til et dokumentikon frem for at knække visningen.
 */
const REGISTRY: Record<string, LucideIcon> = {
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "book-open": BookOpen,
  "calendar-clock": CalendarClock,
  check: Check,
  "chevron-right": ChevronRight,
  "circle-alert": CircleAlert,
  "circle-check": CircleCheck,
  clock: Clock,
  "file-text": FileText,
  info: Info,
  "layout-dashboard": LayoutDashboard,
  "life-buoy": LifeBuoy,
  "message-square": MessageSquare,
  moon: Moon,
  power: Power,
  "rotate-ccw": RotateCcw,
  "scan-line": ScanLine,
  send: Send,
  sparkles: Sparkles,
  "square-pen": SquarePen,
  target: Target,
  "trash-2": Trash2,
  "triangle-alert": TriangleAlert,
  wrench: Wrench,
};

interface Props {
  name: string | null | undefined;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

// Et ukendt ikonnavn fejler ikke, det viser bare et forkert ikon, hvilket er
// nemt at overse. Under udvikling siges det derfor højt, én gang pr. navn.
const warned = new Set<string>();

export function Icon({ name, size = 18, className, strokeWidth = 1.8 }: Props) {
  const known = name ? REGISTRY[name] : undefined;

  if (import.meta.env.DEV && name && !known && !warned.has(name)) {
    warned.add(name);
    console.warn(
      `[Icon] Ukendt ikonnavn "${name}". Registrér det i Icon.tsx, indtil da vises et standardikon.`,
    );
  }

  const Component = known ?? FileText;
  return (
    <Component
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden="true"
      focusable="false"
    />
  );
}
