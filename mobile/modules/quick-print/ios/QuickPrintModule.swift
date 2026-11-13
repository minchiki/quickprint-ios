import ExpoModulesCore
import Foundation
import QuickLook
import PDFKit
import UIKit

final class PreviewSource: NSObject, QLPreviewControllerDataSource {
    let url: URL
    init(_ url: URL) { self.url = url }
    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
}

final class Discovery: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
    let browser = NetServiceBrowser()
    var services: [NetService] = []
    var found: [[String: String]] = []
    func start() { browser.delegate = self; browser.searchForServices(ofType: "_quickprint._tcp.", inDomain: "local.") }
    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) { services.append(service); service.delegate = self; service.resolve(withTimeout: 4) }
    func netServiceDidResolveAddress(_ sender: NetService) { found.append(["name": sender.name, "host": sender.hostName ?? "", "port": String(sender.port)]) }
    func stop() { browser.stop(); services.forEach { $0.stop() } }
}

public class QuickPrintModule: Module {
    private var previewSource: PreviewSource?
    private var discovery: Discovery?
    public func definition() -> ModuleDefinition {
        Name("QuickPrint")
        AsyncFunction("connection") { () -> String in
            guard let connection = try SharedStore.load() else { return "null" }
            // Do not expose bearer credentials to JS, logs or AsyncStorage.
            return String(data: try JSONSerialization.data(withJSONObject: ["computer": connection.computer, "url": connection.url]), encoding: .utf8)!
        }
        AsyncFunction("pair") { (raw: String) -> String in
            let value = try PrintClient.validatePairing(raw)
            var connection = Connection(url: value["url"] as! String, fingerprint: value["fingerprint"] as! String, token: "", computer: "")
            let body = try JSONSerialization.data(withJSONObject: ["code": value["code"]!, "name": "iPhone"])
            let result = try await PrintClient(connection).request("/v1/pair", method: "POST", body: body)
            let json = try JSONSerialization.jsonObject(with: result) as! [String: Any]
            connection.token = json["token"] as! String
            connection.computer = json["computer"] as! String
            try SharedStore.save(connection)
            return connection.computer
        }
        AsyncFunction("request") { (path: String, method: String) -> String in
            guard path.hasPrefix("/v1/"), let connection = try SharedStore.load() else { throw PrintError.message("Сначала подключите компьютер") }
            return String(data: try await PrintClient(connection).request(path, method: method), encoding: .utf8)!
        }
        AsyncFunction("upload") { (uri: String, path: String, key: String) -> String in
            guard path.hasPrefix("/v1/jobs?"), let connection = try SharedStore.load(), let url = URL(string: uri), url.isFileURL else { throw PrintError.message("Не удалось открыть файл или подключение") }
            return String(data: try await PrintClient(connection).request(path, method: "POST", file: url, key: key), encoding: .utf8)!
        }
        AsyncFunction("forget") { try SharedStore.clear() }
        AsyncFunction("setPrinter") { (name: String) in try SharedStore.setPrinter(name) }
        AsyncFunction("pages") { (uri: String) -> Int? in
            guard let url = URL(string: uri) else { return nil }
            if url.pathExtension.lowercased() == "pdf" { return PDFDocument(url: url)?.pageCount }
            if ["jpg", "jpeg", "png"].contains(url.pathExtension.lowercased()) { return 1 }
            return nil
        }
        AsyncFunction("preview") { (uri: String) in
            guard let url = URL(string: uri), url.isFileURL else { throw PrintError.message("Не удалось открыть документ") }
            guard let controller = self.appContext?.utilities?.currentViewController() else { throw PrintError.message("Экран недоступен") }
            let preview = QLPreviewController()
            self.previewSource = PreviewSource(url)
            preview.dataSource = self.previewSource
            controller.present(preview, animated: !UIAccessibility.isReduceMotionEnabled)
        }.runOnQueue(.main)
        AsyncFunction("discover") { () async -> [[String: String]] in
            await MainActor.run { self.discovery = Discovery(); self.discovery?.start() }
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            return await MainActor.run { let found = self.discovery?.found ?? []; self.discovery?.stop(); self.discovery = nil; return found }
        }
    }
}
