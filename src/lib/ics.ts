import type { Shift } from "./types";

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");

export function buildIcs(calName: string, shifts: Pick<Shift, "id" | "start" | "end" | "is_night">[], reminderMinutes = 30, url?: string) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//K-Ville Tracker//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(calName)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  const now = stamp(new Date().toISOString());
  for (const s of shifts) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${s.id}@kville-tracker`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(s.start)}`,
      `DTEND:${stamp(s.end)}`,
      `SUMMARY:${esc(s.is_night ? "⛺ K-Ville night shift" : "⛺ K-Ville tent shift")}`,
      "LOCATION:Krzyzewskiville\\, Duke University",
      ...(url ? [`URL:${url}`] : []),
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:Tent shift soon",
      `TRIGGER:-PT${Math.max(0, Math.round(reminderMinutes))}M`,
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function downloadIcs(groupName: string, shifts: Shift[], reminderMinutes: number) {
  const blob = new Blob([buildIcs(`K-Ville · ${groupName}`, shifts, reminderMinutes)], { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "kville-shifts.ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
