import UIKit
import SwiftUI
import UniformTypeIdentifiers
import QuickLook
import PDFKit

class ShareViewController: UIViewController {
    private var copiedFile: URL?
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let model = ShareModel()
        model.close = { [weak self] in
            if let file = self?.copiedFile { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
            self?.extensionContext?.completeRequest(returningItems: nil)
        }
        let hosting = UIHostingController(rootView: ShareScreen(model: model))
        addChild(hosting); view.addSubview(hosting.view)
        hosting.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([hosting.view.topAnchor.constraint(equalTo: view.topAnchor), hosting.view.bottomAnchor.constraint(equalTo: view.bottomAnchor), hosting.view.leadingAnchor.constraint(equalTo: view.leadingAnchor), hosting.view.trailingAnchor.constraint(equalTo: view.trailingAnchor)])
        hosting.didMove(toParent: self)
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        guard providers.count == 1, let provider = providers.first else { model.error = "Отправьте один документ за раз."; return }
        let types = [UTType.pdf.identifier, "org.openxmlformats.wordprocessingml.document", UTType.png.identifier, UTType.jpeg.identifier, UTType.plainText.identifier]
        guard let type = types.first(where: { provider.hasItemConformingToTypeIdentifier($0) }) else { model.error = "Поддерживаются PDF, DOCX, PNG, JPG и TXT."; return }
        provider.loadFileRepresentation(forTypeIdentifier: type) { [weak self] url, error in
            do {
                guard let url else { throw error ?? PrintError.message("Не удалось прочитать документ") }
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size > 0 && size <= 25 * 1024 * 1024 else { throw PrintError.message("Максимальный размер — 25 МБ") }
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let target = directory.appendingPathComponent(url.lastPathComponent)
                try FileManager.default.copyItem(at: url, to: target)
                self?.copiedFile = target
                DispatchQueue.main.async { model.file = target; model.pages = PDFDocument(url: target)?.pageCount; Task { await model.load() } }
            } catch { DispatchQueue.main.async { model.error = error.localizedDescription } }
        }
    }
}

@MainActor final class ShareModel: ObservableObject {
    @Published var file: URL?
    @Published var pages: Int?
    @Published var printers: [[String: Any]] = []
    @Published var printer = ""
    @Published var copies = 1
    @Published var paper = "A4"
    @Published var landscape = false
    @Published var duplex = false
    @Published var busy = false
    @Published var ready = false
    @Published var error: String?
    @Published var status: String?
    @Published var jobID: String?
    let key = UUID().uuidString
    var close: (() -> Void)?
    var selected: [String: Any]? { printers.first { $0["name"] as? String == printer } }
    var papers: [String] { selected?["papers"] as? [String] ?? ["A4"] }
    var supportsDuplex: Bool { selected?["duplex"] as? Bool ?? false }
    func load() async {
        busy = true; ready = false; defer { busy = false }
        do {
            guard let connection = try SharedStore.load() else { throw PrintError.message("Сначала откройте QuickPrint и подключите компьютер по QR-коду.") }
            let data = try await PrintClient(connection).request("/v1/status")
            let result = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            printers = (result?["printers"] as? [[String: Any]] ?? []).filter { $0["offline"] as? Bool != true }
            printer = (printers.first { $0["name"] as? String == SharedStore.preferredPrinter() } ?? printers.first { $0["default"] as? Bool == true } ?? printers.first)?["name"] as? String ?? ""
            if printer.isEmpty { throw PrintError.message("На компьютере нет доступного принтера.") }
            if result?["sumatra"] as? Bool != true { throw PrintError.message("На компьютере установите SumatraPDF.") }
            if file?.pathExtension.lowercased() == "docx" && result?["docx"] as? Bool != true { throw PrintError.message("Для Word установите LibreOffice на компьютере.") }
            ready = true
            error = nil
        } catch { self.error = error.localizedDescription }
    }
    func printFile() async {
        busy = true; error = nil; defer { busy = false }
        do {
            guard let file, let connection = try SharedStore.load() else { throw PrintError.message("Подключите компьютер в QuickPrint") }
            let client = PrintClient(connection)
            if jobID == nil {
                status = "Передаём документ…"
                var components = URLComponents()
                components.path = "/v1/jobs"
                components.queryItems = [URLQueryItem(name: "printer_name", value: printer), URLQueryItem(name: "extension", value: file.pathExtension), URLQueryItem(name: "copies", value: String(copies)), URLQueryItem(name: "paper", value: paper), URLQueryItem(name: "orientation", value: landscape ? "landscape" : "portrait"), URLQueryItem(name: "duplex", value: String(duplex && supportsDuplex))]
                let result = try await client.request(components.string!, method: "POST", file: file, key: key)
                let job = try JSONSerialization.jsonObject(with: result) as! [String: Any]
                jobID = job["id"] as? String
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            }
            guard let jobID else { throw PrintError.message("Компьютер не вернул номер задания") }
            for _ in 0..<45 {
                let data = try await client.request("/v1/jobs/" + jobID)
                let job = try JSONSerialization.jsonObject(with: data) as! [String: Any]
                let state = job["status"] as? String ?? ""
                status = ["queued": "В очереди", "rendering": "Подготавливаем страницы…", "spooling": "В очереди Windows…", "submitted": "Передано в Windows. Выход бумаги не подтверждён.", "cancelled": "Отменено", "interrupted": "Агент перезапущен. Проверьте очередь Windows."][state] ?? state
                if state == "error" { throw PrintError.message(job["message"] as? String ?? "Ошибка печати") }
                if ["submitted", "cancelled", "interrupted"].contains(state) { return }
                try await Task.sleep(nanoseconds: 2_000_000_000)
            }
            status = "Задание принято. Дальнейшее состояние доступно в истории QuickPrint."
        } catch { self.error = error.localizedDescription }
    }
}

struct ShareScreen: View {
    @ObservedObject var model: ShareModel
    @State private var preview = false
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label(model.file?.lastPathComponent ?? "Получаем документ…", systemImage: "doc.text")
                        .font(.headline)
                    if let pages = model.pages { Text("Страниц: \(pages)").foregroundStyle(.secondary) }
                    Button { preview = true } label: { Label("Предварительный просмотр", systemImage: "doc.viewfinder") }.disabled(model.file == nil)
                }
                Section("Параметры печати") {
                    Picker("Принтер", selection: $model.printer) {
                        ForEach(model.printers.compactMap { $0["name"] as? String }, id: \.self) { Text($0).tag($0) }
                    }.onChange(of: model.printer) { _ in model.duplex = false; model.paper = model.papers.first ?? "A4" }
                    Stepper("Копии: \(model.copies)", value: $model.copies, in: 1...99)
                    Picker("Бумага", selection: $model.paper) { ForEach(model.papers, id: \.self) { Text($0).tag($0) } }
                    Toggle("Альбомная ориентация", isOn: $model.landscape)
                    if model.supportsDuplex { Toggle("С двух сторон", isOn: $model.duplex) }
                }.disabled(model.busy || model.jobID != nil)
                if let error = model.error {
                    Section { Text(error).foregroundStyle(.red); if model.printer.isEmpty { Button("Повторить подключение") { Task { await model.load() } } } }
                }
                if let status = model.status { Section { Text(status).accessibilityAddTraits(.updatesFrequently) } }
                Section {
                    Button { Task { await model.printFile() } } label: {
                        HStack { if model.busy { ProgressView() }; Text(model.jobID == nil ? "Напечатать" : "Обновить состояние").fontWeight(.semibold) }
                    }.disabled(model.busy || model.file == nil || model.printer.isEmpty || (!model.ready && model.jobID == nil))
                }
                Section { Text("Документ отправляется напрямую на ваш компьютер по защищённому соединению.").font(.footnote).foregroundStyle(.secondary) }
            }
            .navigationTitle("QuickPrint")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Готово") { model.close?() }.disabled(model.busy && model.jobID == nil) } }
            .sheet(isPresented: $preview) { if let file = model.file { QuickPreview(file: file) } }
        }.tint(Color(red: 0.14, green: 0.35, blue: 0.83))
    }
}

struct QuickPreview: UIViewControllerRepresentable {
    let file: URL
    func makeCoordinator() -> Coordinator { Coordinator(file) }
    func makeUIViewController(context: Context) -> QLPreviewController { let view = QLPreviewController(); view.dataSource = context.coordinator; return view }
    func updateUIViewController(_ uiViewController: QLPreviewController, context: Context) {}
    class Coordinator: NSObject, QLPreviewControllerDataSource {
        let file: URL
        init(_ file: URL) { self.file = file }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { file as NSURL }
    }
}
