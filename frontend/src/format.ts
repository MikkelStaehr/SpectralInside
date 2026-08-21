const dateTime = new Intl.DateTimeFormat("da-DK", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const dateOnly = new Intl.DateTimeFormat("da-DK", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function formatWhen(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function formatDate(iso: string): string {
  return dateOnly.format(new Date(iso));
}

/** Lokal dato som YYYY-MM-DD. Bruges til at nulstille trin-afkrydsning hver dag. */
export function todayKey(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function describeDue(days: number | null): string {
  if (days === null) return "";
  if (days < 0) {
    const overdue = Math.abs(days);
    return overdue === 1 ? "1 dag over tid" : `${overdue} dage over tid`;
  }
  if (days === 0) return "forfalder i dag";
  if (days === 1) return "forfalder i morgen";
  return `om ${days} dage`;
}
