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
    background: "#F2F2F7",
    surface: "#FFFFFF",
    text: "#111111",
    muted: "#636366",
    action: "#006BC7",
    onAction: "#FFFFFF",
    error: "#B42332",
    line: "#D1D1D6",
    tint: "#E8F2FC",
  },
  dark: {
    background: "#000000",
    surface: "#1C1C1E",
    text: "#FFFFFF",
    muted: "#AEAEB2",
    action: "#70B8FF",
    onAction: "#001B35",
    error: "#FFABB5",
    line: "#38383A",
    tint: "#102A43",
  },
};
