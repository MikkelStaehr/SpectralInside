import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BadgeCheck,
  BookOpen,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  FileText,
  Images,
  Info,
  LayoutDashboard,
  LifeBuoy,
  MessageSquare,
  Minus,
  Moon,
  Plus,
  Power,
  RotateCcw,
  ScanLine,
  Send,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Target,
  Trash2,
  TriangleAlert,
  Wifi,
  WifiOff,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

/**
 * Ikonnavne skrives i kebab-case, som lucide selv bruger dem. Procedurerne
 * vælger deres eget ikon i frontmatter (`icon: scan-line`), så nye
 * arbejdsgange kan få et passende ikon uden ændringer i koden. Ukendte navne
 * falder tilbage til et dokumentikon frem for at knække visningen.
 */
const REGISTRY: Record<string, LucideIcon> = {
  "arrow-down": ArrowDown,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "arrow-up": ArrowUp,
  "badge-check": BadgeCheck,
  "book-open": BookOpen,
  "calendar-clock": CalendarClock,
  check: Check,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "circle-alert": CircleAlert,
  "circle-check": CircleCheck,
  "circle-x": CircleX,
  clock: Clock,
  "file-text": FileText,
  images: Images,
  info: Info,
  "layout-dashboard": LayoutDashboard,
  "life-buoy": LifeBuoy,
  "message-square": MessageSquare,
  minus: Minus,
  moon: Moon,
  plus: Plus,
  power: Power,
  "rotate-ccw": RotateCcw,
  "scan-line": ScanLine,
  send: Send,
  sliders: SlidersHorizontal,
  sparkles: Sparkles,
  "square-pen": SquarePen,
  target: Target,
  "trash-2": Trash2,
  "triangle-alert": TriangleAlert,
  wifi: Wifi,
  "wifi-off": WifiOff,
  wrench: Wrench,
  x: X,
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
