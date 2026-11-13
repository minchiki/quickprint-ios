export type Printer = {
  name: string;
  default: boolean;
  duplex: boolean;
  papers: string[];
  offline: boolean;
  status_bits: number;
};
export type Status = {
  computer: string;
  printers: Printer[];
  sumatra: boolean;
  docx: boolean;
  max_bytes: number;
};
export type Job = {
  id: string;
  created: number;
  status: string;
  ext: string;
  pages: number | null;
  message?: string;
  options: { printer: string; copies: number };
};
export const labels: Record<string, string> = {
  queued: "В очереди",
  rendering: "Подготовка страниц",
  spooling: "В очереди Windows",
  submitted: "Передано в Windows",
  error: "Не удалось напечатать",
  cancelled: "Отменено",
  interrupted: "Проверьте очередь Windows",
};
export const themes = {
  light: {
    background: "#F3F5F9",
    surface: "#FFFFFF",
    text: "#172239",
    muted: "#58657A",
    action: "#2458D3",
    onAction: "#FFFFFF",
    error: "#B42332",
    line: "#D5DBE6",
    tint: "#E8EEFC",
  },
  dark: {
    background: "#10141D",
    surface: "#1C2330",
    text: "#F4F6FC",
    muted: "#B0BDD1",
    action: "#A9C1FF",
    onAction: "#101C36",
    error: "#FFABB5",
    line: "#46536B",
    tint: "#253452",
  },
};
