const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatTime12h(date: Date): string {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes.toString().padStart(2, "0")} ${ampm}`;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Formats a relative time string from a Slack timestamp.
 * Pure human-readable, no machine ID embedded.
 */
export function formatRelativeTime(ts: string, now?: Date): string {
  const seconds = parseFloat(ts);
  if (isNaN(seconds)) {
    return ts;
  }

  const date = new Date(seconds * 1000);
  const ref = now ?? new Date();
  const diffMs = ref.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;

  const time = formatTime12h(date);
  const todayStart = startOfDay(ref);
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
  const weekStart = new Date(todayStart.getTime() - 6 * 86_400_000);

  if (date >= todayStart) return `today at ${time}`;
  if (date >= yesterdayStart) return `yesterday at ${time}`;
  if (date >= weekStart) return `${DAY_NAMES[date.getDay()]!} at ${time}`;

  const month = MONTH_NAMES[date.getMonth()]!;
  const day = date.getDate();

  if (date.getFullYear() === ref.getFullYear()) {
    return `${month} ${day} at ${time}`;
  }

  return `${month} ${day}, ${date.getFullYear()} at ${time}`;
}

/**
 * Formats a Slack timestamp as "relative time (raw_ts)" for use in fields
 * where the LLM needs both human context and the raw ts for API calls.
 *
 *   "today at 1:23 PM (1771574618.875419)"
 */
export function formatSlackTimestamp(ts: string, now?: Date): string {
  const relative = formatRelativeTime(ts, now);
  if (relative === ts) return ts; // non-numeric, return as-is
  return `${relative} (${ts})`;
}
