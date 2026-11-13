import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { CameraView, useCameraPermissions } from "expo-camera";
import { bridge } from "../modules/quick-print";
import { Job, labels, Status, themes } from "./model";

type Screen = "home" | "history" | "settings" | "connect" | "preview" | "job";
type Document = {
  uri: string;
  name: string;
  size: number;
  ext: string;
  pages: number | null;
  key: string;
};
type UIValue = {
  c: typeof themes.light;
  busy: boolean;
  status: Status | null;
  printer: string;
  setPrinter: (value: string) => void;
  setActiveJob: (job: Job) => void;
  navigate: (screen: Screen) => void;
};
const UI = React.createContext<UIValue>(null as unknown as UIValue);
const preferenceFile = new File(Paths.document, "preferences.json");
const historyFile = new File(Paths.document, "history.json");
const pendingFile = new File(Paths.document, "pending-document.json");
function readJSON(file: File, fallback: any) {
  try {
    return JSON.parse(file.textSync());
  } catch {
    return fallback;
  }
}

export default function Main() {
  return (
    <SafeAreaProvider>
      <QuickPrint />
    </SafeAreaProvider>
  );
}
function QuickPrint() {
  const system = useColorScheme();
  const [initial] = useState(() =>
    readJSON(preferenceFile, { theme: "system", printer: "" }),
  );
  const [theme, setTheme] = useState<"system" | "light" | "dark">(
    initial.theme,
  );
  const [printer, setPrinter] = useState<string>(initial.printer);
  const c =
    themes[theme === "system" ? (system === "dark" ? "dark" : "light") : theme];
  const [screen, setScreen] = useState<Screen>("home");
  const [connection, setConnection] = useState<{
    computer: string;
    url: string;
  } | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [jobs, setJobs] = useState<Job[]>(() =>
    readJSON(historyFile, []).filter(
      (job: Job) => Date.now() / 1000 - job.created < 7 * 86400,
    ),
  );
  const [historyCount, setHistoryCount] = useState(30);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [document, setDocument] = useState<Document | null>(null);
  const [copies, setCopies] = useState(1);
  const [paper, setPaper] = useState("A4");
  const [landscape, setLandscape] = useState(false);
  const [duplex, setDuplex] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(false);
  const [qr, setQR] = useState("");
  const [scan, setScan] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [found, setFound] = useState<string[] | null>(null);
  const [reduced, setReduced] = useState(false);
  const selected = status?.printers.find((p) => p.name === printer);
  const locked = useRef(false);
  const pollBusy = useRef(false);

  useEffect(() => {
    const pending = readJSON(pendingFile, null);
    if (pending?.uri?.startsWith(Paths.cache.uri)) {
      try {
        new File(pending.uri).delete();
      } catch {}
    }
    if (pendingFile.exists) pendingFile.delete();
  }, []);
  useEffect(() => {
    preferenceFile.write(JSON.stringify({ theme, printer }));
    if (printer) {
      try {
        bridge()
          .setPrinter(printer)
          .catch(() => {});
      } catch {}
    }
  }, [theme, printer]);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const listener = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => listener.remove();
  }, []);
  const refresh = useCallback(async () => {
    if (pollBusy.current) return;
    pollBusy.current = true;
    try {
      const saved = JSON.parse(await bridge().connection());
      setConnection(saved);
      if (!saved) {
        setOnline(false);
        return;
      }
      const [info, recent] = await Promise.all([
        bridge().request("/v1/status", "GET"),
        bridge().request("/v1/jobs", "GET"),
      ]);
      const next: Status = JSON.parse(info);
      const list: Job[] = JSON.parse(recent);
      setStatus(next);
      setJobs(list);
      setOnline(true);
      historyFile.write(JSON.stringify(list));
      setPrinter((current) =>
        next.printers.some((p) => p.name === current)
          ? current
          : ((next.printers.find((p) => p.default) ?? next.printers[0])?.name ??
            ""),
      );
      setActiveJob((current) =>
        current ? (list.find((j) => j.id === current.id) ?? current) : null,
      );
    } catch (e) {
      setOnline(false);
      setError(message(e));
    } finally {
      pollBusy.current = false;
    }
  }, []);
  useEffect(() => {
    const initialRefresh = setTimeout(() => {
      void refresh();
    }, 0);
    const timer = setInterval(() => {
      if (AppState.currentState === "active") refresh();
    }, 4000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      clearTimeout(initialRefresh);
      clearInterval(timer);
      subscription.remove();
    };
  }, [refresh]);
  async function action(work: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(message(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  function navigate(next: Screen) {
    setError("");
    setScreen(next);
  }
  async function pick() {
    await action(async () => {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "image/png",
          "image/jpeg",
          "text/plain",
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      if (document) {
        try {
          new File(document.uri).delete();
        } catch {}
      }
      const size = file.size ?? new File(file.uri).size;
      if (size > 25 * 1024 * 1024 || size <= 0) {
        new File(file.uri).delete();
        throw new Error("Выберите документ размером до 25 МБ.");
      }
      pendingFile.write(JSON.stringify({ uri: file.uri }));
      setDocument({
        uri: file.uri,
        name: file.name,
        ext: file.name.split(".").pop()?.toLowerCase() ?? "",
        size,
        pages: await bridge().pages(file.uri),
        key: Crypto.randomUUID(),
      });
      setCopies(1);
      setDuplex(false);
      setScreen("preview");
    });
  }
  async function pair(raw: string) {
    setScan(false);
    await action(async () => {
      await bridge().pair(raw);
      setQR("");
      await refresh();
      navigate("home");
    });
  }
  async function print() {
    await action(async () => {
      if (!document || !selected)
        throw new Error("Выберите документ и принтер.");
      const params = new URLSearchParams({
        printer_name: printer,
        extension: document.ext,
        copies: String(copies),
        paper: selected.papers.includes(paper) ? paper : selected.papers[0],
        orientation: landscape ? "landscape" : "portrait",
        duplex: String(duplex && selected.duplex),
      });
      const result = JSON.parse(
        await bridge().upload(document.uri, `/v1/jobs?${params}`, document.key),
      );
      setActiveJob(result);
      setScreen("job");
      try {
        new File(document.uri).delete();
      } catch {}
      if (pendingFile.exists) pendingFile.delete();
      setDocument(null);
      await Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      await refresh();
    });
  }
  return (
    <UI.Provider
      value={{
        c,
        busy,
        status,
        printer,
        setPrinter: (name) => {
          setPrinter(name);
          setDuplex(false);
          setPaper(
            status?.printers.find((p) => p.name === name)?.papers[0] ?? "A4",
          );
        },
        setActiveJob,
        navigate,
      }}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
        <StatusBar
          style={
            theme === "dark" || (theme === "system" && system === "dark")
              ? "light"
              : "dark"
          }
        />
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {["connect", "preview", "job"].includes(screen) && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="На главную"
              onPress={() => navigate("home")}
              style={styles.back}
            >
              <Ionicons
                name="chevron-back"
                size={22}
                color={c.action}
                accessible={false}
              />
              <Text style={{ color: c.action, fontSize: 17 }}>Главная</Text>
            </Pressable>
          )}
          {screen === "home" && (
            <>
              <View style={styles.brand}>
                <Ionicons
                  name="print-outline"
                  size={26}
                  color={c.action}
                  accessible={false}
                />
                <T bold>QuickPrint</T>
              </View>
              <Heading>Печать рядом.</Heading>
              <T muted>С телефона — на ваш принтер.</T>
              <View style={[styles.computer, { backgroundColor: c.surface }]}>
                <View style={[styles.monitor, { backgroundColor: c.tint }]}>
                  <Ionicons
                    name="desktop-outline"
                    size={42}
                    color={c.action}
                    accessible={false}
                  />
                </View>
                <T size={24} bold>
                  {connection?.computer ?? "Подключим компьютер"}
                </T>
                <T muted>
                  {connection
                    ? online
                      ? "Доступен в локальной сети"
                      : "Компьютер недоступен"
                    : "Один раз отсканируйте QR-код на ПК."}
                </T>
                {online && (
                  <T size={14} muted>
                    {printer || "Принтер не найден"}
                  </T>
                )}
                {!online && (
                  <Button
                    title={
                      connection
                        ? "Проверить подключение"
                        : "Подключить компьютер"
                    }
                    secondary
                    onPress={() =>
                      connection ? action(refresh) : navigate("connect")
                    }
                  />
                )}
              </View>
              <Button
                title="Выбрать документ"
                icon="add-circle-outline"
                onPress={pick}
                disabled={!online}
              />
              <T muted size={14}>
                PDF, Word, фото и текст · до 25 МБ
              </T>
              <View style={styles.sectionTitle}>
                <T size={24} bold>
                  Недавние
                </T>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => navigate("history")}
                  style={styles.back}
                >
                  <Text style={{ color: c.action, fontSize: 17 }}>
                    Все задания
                  </Text>
                </Pressable>
              </View>
              {jobs.length ? (
                jobs.slice(0, 3).map((job) => <Row key={job.id} job={job} />)
              ) : (
                <View style={styles.empty}>
                  <Ionicons
                    name="documents-outline"
                    size={36}
                    color={c.muted}
                    accessible={false}
                  />
                  <T bold>Здесь появятся ваши задания</T>
                  <T muted>
                    Выберите первый документ. Мы покажем его перед печатью.
                  </T>
                </View>
              )}
            </>
          )}
          {screen === "history" && (
            <>
              <Heading>История</Heading>
              <T muted>
                {online
                  ? "Задания за последние 7 дней"
                  : "Сохранённая история. ПК недоступен."}
              </T>
              {jobs.slice(0, historyCount).map((job) => (
                <Row key={job.id} job={job} />
              ))}
              {jobs.length > historyCount && (
                <Button
                  title="Показать ещё"
                  secondary
                  onPress={() => setHistoryCount((v) => v + 30)}
                />
              )}
              {!jobs.length && (
                <T>Пока нет заданий. Начните с выбора документа на главной.</T>
              )}
              <Button
                title="Обновить"
                secondary
                onPress={() => action(refresh)}
              />
            </>
          )}
          {screen === "settings" && (
            <>
              <Heading>Настройки</Heading>
              <Section>
                <T bold>Принтер по умолчанию</T>
                <PrinterChoices />
                {!status?.printers.length && (
                  <T muted>Подключите компьютер, чтобы выбрать принтер.</T>
                )}
              </Section>
              <Section>
                <T bold>Оформление</T>
                {(["system", "light", "dark"] as const).map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: value === theme }}
                    onPress={() => setTheme(value)}
                    style={styles.choice}
                  >
                    <Ionicons
                      name={
                        value === theme ? "radio-button-on" : "radio-button-off"
                      }
                      size={22}
                      color={c.action}
                      accessible={false}
                    />
                    <T>
                      {
                        {
                          system: "Как на iPhone",
                          light: "Светлое",
                          dark: "Тёмное",
                        }[value]
                      }
                    </T>
                  </Pressable>
                ))}
              </Section>
              <Section>
                <T bold>Компьютер</T>
                <T muted>{connection?.computer ?? "Не подключён"}</T>
                <Button
                  title="Подключение"
                  secondary
                  onPress={() => navigate("connect")}
                />
                {connection && (
                  <Button
                    title="Отключить этот iPhone"
                    secondary
                    onPress={() =>
                      Alert.alert(
                        "Отключить компьютер?",
                        "Для следующей печати понадобится новый QR-код.",
                        [
                          { text: "Отмена", style: "cancel" },
                          {
                            text: "Отключить",
                            style: "destructive",
                            onPress: () =>
                              action(async () => {
                                await bridge().request("/v1/device", "DELETE");
                                await bridge().forget();
                                setConnection(null);
                                setStatus(null);
                                setJobs([]);
                                historyFile.write("[]");
                                setOnline(false);
                              }),
                          },
                        ],
                      )
                    }
                  />
                )}
              </Section>
              <Section>
                <T bold>Если печать не начинается</T>
                <T muted>
                  Проверьте питание принтера, USB-кабель и значок QuickPrint в
                  трее Windows. iPhone и ПК должны быть в одной сети. Гостевая
                  Wi-Fi сеть может блокировать соединение.
                </T>
                <T muted>
                  «Передано в Windows» означает передачу в систему печати.
                  Физический выход бумаги приложение не подтверждает.
                </T>
              </Section>
            </>
          )}
          {screen === "connect" && (
            <>
              <Heading>{"Ваш компьютер.\nВсегда рядом."}</Heading>
              <T muted>
                Откройте QuickPrint в трее Windows и выберите «Подключить
                iPhone».
              </T>
              <Section>
                <Ionicons
                  name="qr-code-outline"
                  size={64}
                  color={c.action}
                  accessible={false}
                />
                <T size={24} bold>
                  Одно сканирование
                </T>
                <T muted>
                  QR-код защищает подключение к вашему ПК. Он действует 5 минут.
                </T>
                <Button
                  title="Сканировать QR-код"
                  icon="scan-outline"
                  onPress={() =>
                    action(async () => {
                      const p = permission?.granted
                        ? permission
                        : await requestPermission();
                      if (!p.granted)
                        throw new Error(
                          "Разрешите камеру в настройках iPhone или вставьте данные QR-кода ниже.",
                        );
                      setScan(true);
                    })
                  }
                />
              </Section>
              <Button
                title="Найти компьютер в сети"
                secondary
                onPress={() =>
                  action(async () => {
                    const list = await bridge().discover();
                    setFound(list.map((item) => item.name));
                  })
                }
              />
              {found && (
                <T muted>
                  {found.length
                    ? `Найдены: ${found.join(", ")}. Откройте QR-код на нужном ПК.`
                    : "Компьютер не найден. Проверьте сеть и брандмауэр Windows. Можно подключиться по QR-коду."}
                </T>
              )}
              <T bold>Данные QR-кода вручную</T>
              <TextInput
                accessibilityLabel="Данные QR-кода"
                value={qr}
                onChangeText={setQR}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Вставьте текст с экрана ПК…"
                placeholderTextColor={c.muted}
                style={[
                  styles.input,
                  {
                    color: c.text,
                    backgroundColor: c.surface,
                    borderColor: c.line,
                  },
                ]}
              />
              <Button
                title="Подключить"
                secondary
                disabled={!qr.trim()}
                onPress={() => pair(qr)}
              />
            </>
          )}
          {screen === "preview" && document && (
            <>
              <Heading>Готово к печати</Heading>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Открыть предварительный просмотр документа"
                onPress={() =>
                  action(async () => bridge().preview(document.uri))
                }
                style={[
                  styles.document,
                  { backgroundColor: c.surface, borderColor: c.line },
                ]}
              >
                {["png", "jpg", "jpeg"].includes(document.ext) ? (
                  <Image
                    source={{ uri: document.uri }}
                    resizeMode="contain"
                    accessibilityLabel={document.name}
                    style={{ width: "100%", height: 220 }}
                  />
                ) : (
                  <Ionicons
                    name="document-text-outline"
                    size={80}
                    color={c.action}
                    accessible={false}
                  />
                )}
                <T bold>{document.name}</T>
                <T muted size={14}>
                  {document.pages
                    ? `${document.pages} стр.`
                    : "Страницы будут рассчитаны на ПК"}{" "}
                  · {(document.size / 1024 / 1024).toFixed(1)} МБ
                </T>
                <Text style={{ color: c.action, fontSize: 17 }}>
                  Открыть предпросмотр
                </Text>
              </Pressable>
              <Section>
                <T bold>Принтер</T>
                <PrinterChoices />
              </Section>
              <Section>
                <View style={styles.sectionTitle}>
                  <T bold>Копии</T>
                  <View style={styles.stepper}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Уменьшить количество копий"
                      disabled={copies <= 1 || busy}
                      onPress={() => setCopies((v) => v - 1)}
                      style={[styles.step, { backgroundColor: c.tint }]}
                    >
                      <Ionicons
                        name="remove"
                        size={24}
                        color={c.action}
                        accessible={false}
                      />
                    </Pressable>
                    <T bold>{copies}</T>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Увеличить количество копий"
                      disabled={copies >= 99 || busy}
                      onPress={() => setCopies((v) => v + 1)}
                      style={[styles.step, { backgroundColor: c.tint }]}
                    >
                      <Ionicons
                        name="add"
                        size={24}
                        color={c.action}
                        accessible={false}
                      />
                    </Pressable>
                  </View>
                </View>
                <T bold>Бумага</T>
                <View style={styles.papers}>
                  {(selected?.papers ?? ["A4"]).map((value) => (
                    <Pressable
                      key={value}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: value === paper }}
                      onPress={() => setPaper(value)}
                      style={[
                        styles.choice,
                        { borderColor: value === paper ? c.action : c.line },
                      ]}
                    >
                      <T>{value}</T>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.sectionTitle}>
                  <T>Альбомная ориентация</T>
                  <Switch
                    accessibilityLabel="Альбомная ориентация"
                    value={landscape}
                    onValueChange={setLandscape}
                  />
                </View>
                {selected?.duplex ? (
                  <View style={styles.sectionTitle}>
                    <T>С двух сторон</T>
                    <Switch
                      accessibilityLabel="Двусторонняя печать"
                      value={duplex}
                      onValueChange={setDuplex}
                    />
                  </View>
                ) : (
                  <T size={14} muted>
                    Автоматическая двусторонняя печать недоступна.
                  </T>
                )}
              </Section>
              {!status?.sumatra && (
                <T muted>На ПК необходимо установить SumatraPDF.</T>
              )}
              {document.ext === "docx" && !status?.docx && (
                <T muted>Для Word установите LibreOffice на ПК.</T>
              )}
              <Button
                title={busy ? "Отправляем…" : "Напечатать"}
                icon="print-outline"
                disabled={
                  !online ||
                  !selected ||
                  !status?.sumatra ||
                  (document.ext === "docx" && !status?.docx)
                }
                onPress={print}
              />
            </>
          )}
          {screen === "job" && activeJob && (
            <>
              <Heading>{labels[activeJob.status] ?? activeJob.status}</Heading>
              <Section>
                <Ionicons
                  name={
                    activeJob.status === "error"
                      ? "alert-circle-outline"
                      : "print-outline"
                  }
                  size={64}
                  color={activeJob.status === "error" ? c.error : c.action}
                  accessible={false}
                />
                <T size={24} bold>
                  {activeJob.options.printer}
                </T>
                <T>
                  {activeJob.ext.slice(1).toUpperCase()} ·{" "}
                  {activeJob.options.copies} коп.
                </T>
                <T muted>
                  {activeJob.message ??
                    "Документ обрабатывается на компьютере."}
                </T>
                {activeJob.pages && <T muted>Страниц: {activeJob.pages}</T>}
              </Section>
              <T muted>
                Фактический выход бумаги не подтверждается. При ошибке проверьте
                очередь Windows перед повторной отправкой.
              </T>
              {activeJob.status === "queued" && (
                <Button
                  title="Отменить задание"
                  secondary
                  onPress={() =>
                    action(async () => {
                      const job = JSON.parse(
                        await bridge().request(
                          `/v1/jobs/${activeJob.id}`,
                          "DELETE",
                        ),
                      );
                      setActiveJob(job);
                      await refresh();
                    })
                  }
                />
              )}
              <Button
                title="Обновить состояние"
                secondary
                onPress={() => action(refresh)}
              />
              <Button title="На главную" onPress={() => navigate("home")} />
            </>
          )}
          {busy && (
            <View
              accessibilityRole="progressbar"
              accessibilityLabel="Выполняется действие"
              style={styles.busy}
            >
              <ActivityIndicator color={c.action} />
              <T muted>Подождите…</T>
            </View>
          )}
          {!!error && (
            <View
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={[styles.section, { borderWidth: 1, borderColor: c.error }]}
            >
              <Text
                selectable
                style={{ color: c.error, fontSize: 16, lineHeight: 24 }}
              >
                {error}
              </Text>
            </View>
          )}
        </ScrollView>
        {["home", "history", "settings"].includes(screen) && (
          <View
            style={[
              styles.tabs,
              { backgroundColor: c.surface, borderTopColor: c.line },
            ]}
          >
            {(
              [
                { key: "home", title: "Главная", icon: "home-outline" },
                { key: "history", title: "История", icon: "time-outline" },
                {
                  key: "settings",
                  title: "Настройки",
                  icon: "options-outline",
                },
              ] as const
            ).map((tab) => (
              <Pressable
                key={tab.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: screen === tab.key }}
                onPress={() => navigate(tab.key)}
                style={styles.tab}
              >
                <Ionicons
                  name={tab.icon}
                  size={24}
                  color={screen === tab.key ? c.action : c.muted}
                  accessible={false}
                />
                <Text
                  style={{
                    color: screen === tab.key ? c.action : c.muted,
                    fontSize: 13,
                  }}
                >
                  {tab.title}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        <Modal
          visible={scan}
          animationType={reduced ? "none" : "slide"}
          onRequestClose={() => setScan(false)}
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
            <View style={{ flex: 1 }}>
              <CameraView
                style={{ flex: 1 }}
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={
                  scan && !busy ? ({ data }) => pair(data) : undefined
                }
              />
            </View>
            <View style={{ padding: 24 }}>
              <T>Наведите камеру на QR-код QuickPrint на компьютере.</T>
              <Button title="Отмена" onPress={() => setScan(false)} secondary />
            </View>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </UI.Provider>
  );
}
function T({
  children,
  muted = false,
  size = 17,
  bold = false,
}: {
  children: React.ReactNode;
  muted?: boolean;
  size?: number;
  bold?: boolean;
}) {
  const { c } = React.useContext(UI);
  return (
    <Text
      style={{
        color: muted ? c.muted : c.text,
        fontSize: size,
        fontWeight: bold ? "600" : "400",
        lineHeight: size * 1.4,
        flexShrink: 1,
      }}
    >
      {children}
    </Text>
  );
}
function Button({
  title,
  onPress,
  secondary = false,
  disabled = false,
  icon,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { c, busy } = React.useContext(UI);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: secondary ? c.tint : c.action,
          opacity: disabled || busy ? 0.5 : pressed ? 0.75 : 1,
        },
      ]}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={22}
          color={secondary ? c.action : c.onAction}
          accessible={false}
        />
      )}
      <Text
        style={{
          color: secondary ? c.action : c.onAction,
          fontSize: 17,
          fontWeight: "600",
          flexShrink: 1,
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
function Section({ children }: { children: React.ReactNode }) {
  const { c } = React.useContext(UI);
  return (
    <View style={[styles.section, { backgroundColor: c.surface }]}>
      {children}
    </View>
  );
}
function Heading({ children }: { children: string }) {
  const { c } = React.useContext(UI);
  return (
    <Text
      accessibilityRole="header"
      style={[styles.heading, { color: c.text }]}
    >
      {children}
    </Text>
  );
}
function Row({ job }: { job: Job }) {
  const { c, setActiveJob, navigate } = React.useContext(UI);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${job.ext.slice(1).toUpperCase()}, ${labels[job.status]}, ${new Date(job.created * 1000).toLocaleString("ru-RU")}`}
      onPress={() => {
        setActiveJob(job);
        navigate("job");
      }}
      style={({ pressed }) => [
        styles.jobRow,
        { borderBottomColor: c.line, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <View style={[styles.fileIcon, { backgroundColor: c.tint }]}>
        <Ionicons
          name="document-text-outline"
          size={24}
          color={c.action}
          accessible={false}
        />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <T bold>
          {job.ext.slice(1).toUpperCase()} · {job.options.copies} коп.
        </T>
        <T size={14} muted>
          {labels[job.status] ?? job.status}
        </T>
        <T size={14} muted>
          {new Date(job.created * 1000).toLocaleString("ru-RU")}
        </T>
      </View>
      <Ionicons
        name="chevron-forward"
        size={18}
        color={c.muted}
        accessible={false}
      />
    </Pressable>
  );
}
function PrinterChoices() {
  const { c, busy, status, printer, setPrinter } = React.useContext(UI);
  return (
    <View style={{ gap: 8 }}>
      {status?.printers.map((p) => (
        <Pressable
          key={p.name}
          accessibilityRole="radio"
          accessibilityState={{
            selected: p.name === printer,
            disabled: p.offline,
          }}
          disabled={busy || p.offline}
          onPress={() => setPrinter(p.name)}
          style={[
            styles.choice,
            { borderColor: p.name === printer ? c.action : c.line },
          ]}
        >
          <Ionicons
            name={p.name === printer ? "radio-button-on" : "radio-button-off"}
            size={22}
            color={c.action}
            accessible={false}
          />
          <T>
            {p.name}
            {p.offline ? " — не в сети" : ""}
          </T>
        </Pressable>
      ))}
    </View>
  );
}

function message(e: unknown) {
  return e instanceof Error
    ? e.message
    : "Не удалось выполнить действие. Попробуйте ещё раз.";
}
const styles = StyleSheet.create({
  content: {
    padding: 24,
    gap: 16,
    maxWidth: 640,
    width: "100%",
    alignSelf: "center",
    paddingBottom: 40,
  },
  heading: {
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: -0.8,
    marginTop: 12,
  },
  brand: { flexDirection: "row", gap: 10, alignItems: "center" },
  computer: { padding: 24, borderRadius: 24, gap: 12, marginTop: 12 },
  monitor: {
    width: 80,
    height: 72,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  button: {
    minHeight: 54,
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 20,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  section: { padding: 20, gap: 16, borderRadius: 18 },
  sectionTitle: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
  },
  jobRow: {
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  fileIcon: {
    width: 48,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  empty: { paddingVertical: 28, gap: 12, alignItems: "flex-start" },
  tabs: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    paddingBottom: 8,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
    gap: 5,
    minHeight: 56,
  },
  back: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 4 },
  input: {
    minHeight: 140,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    fontSize: 16,
    textAlignVertical: "top",
  },
  choice: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: "transparent",
    padding: 12,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  document: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 24,
    gap: 16,
    alignItems: "center",
    minHeight: 260,
    justifyContent: "center",
  },
  stepper: { flexDirection: "row", alignItems: "center", gap: 16 },
  step: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  papers: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  busy: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    padding: 12,
  },
});
