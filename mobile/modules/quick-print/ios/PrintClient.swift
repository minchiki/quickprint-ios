import Foundation
import Security
import CryptoKit

struct Connection: Codable {
    var url: String
    var fingerprint: String
    var token: String
    var computer: String
}

enum PrintError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self { case .message(let message): return message }
    }
}

enum SharedStore {
    static var group: String { Bundle.main.object(forInfoDictionaryKey: "QuickPrintAppGroup") as? String ?? "group.local.quickprint.app" }
    // Provision metadata supplies candidate identifiers only; iOS authorizes container access.
    static func provisionGroups(_ data: Data) -> [String] {
        guard let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
              let value = try? PropertyListSerialization.propertyList(from: data[start.lowerBound..<end.upperBound], format: nil) as? [String: Any],
              let entitlements = value["Entitlements"] as? [String: Any] else { return [] }
        return entitlements["com.apple.security.application-groups"] as? [String] ?? []
    }
    static func candidates(configured: String, signed: [String]) -> [String] {
        var result = signed.filter { $0 == configured || $0.hasPrefix(configured + ".") }
        if result.isEmpty && Set(signed).count == 1 { result = signed }
        result.append(configured)
        var seen = Set<String>()
        return result.filter { seen.insert($0).inserted }
    }
    static var sharedRoot: URL? {
        let metadata = Bundle.main.object(forInfoDictionaryKey: "ALTAppGroups") as? [String] ?? []
        let provision = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision")
            .flatMap { try? Data(contentsOf: $0) }.map(provisionGroups) ?? []
        for candidate in candidates(configured: group, signed: metadata + provision) {
            if let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: candidate) { return url }
        }
        return nil
    }
    static var root: URL {
        get throws {
            if let shared = sharedRoot { return shared }
            guard Bundle.main.bundleURL.pathExtension != "appex" else {
                throw PrintError.message("Подпись не предоставила общий контейнер. Откройте QuickPrint и выберите документ внутри приложения. Для меню «Поделиться» переустановите IPA с расширением и App Group.")
            }
            let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("QuickPrint", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            return directory
        }
    }
    static func load() throws -> Connection? {
        let file = try root.appendingPathComponent("connection.json")
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        return try JSONDecoder().decode(Connection.self, from: Data(contentsOf: file))
    }
    static func save(_ connection: Connection) throws {
        let file = try root.appendingPathComponent("connection.json")
        try JSONEncoder().encode(connection).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var directory = try root
        try directory.setResourceValues(values)
    }
    static func clear() throws {
        let file = try root.appendingPathComponent("connection.json")
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }
    static func preferredPrinter() -> String? {
        guard let directory = try? root, let data = try? Data(contentsOf: directory.appendingPathComponent("printer.txt")) else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func setPrinter(_ name: String) throws {
        try Data(name.utf8).write(to: root.appendingPathComponent("printer.txt"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}

final class PrintClient: NSObject, URLSessionDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    let connection: Connection
    init(_ connection: Connection) { self.connection = connection }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              challenge.protectionSpace.host == URL(string: connection.url)?.host,
              let trust = challenge.protectionSpace.serverTrust,
              let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let cert = chain.first else {
            completionHandler(.cancelAuthenticationChallenge, nil); return
        }
        let fingerprint = SHA256.hash(data: SecCertificateCopyData(cert) as Data).map { String(format: "%02x", $0) }.joined()
        guard fingerprint == connection.fingerprint.lowercased() else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil) // Never forward a bearer token across a redirect.
    }
    func request(_ path: String, method: String = "GET", body: Data? = nil, file: URL? = nil, key: String? = nil) async throws -> Data {
        guard let url = URL(string: connection.url + path), url.scheme == "https", url.user == nil, url.password == nil else { throw PrintError.message("Некорректный HTTPS-адрес") }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 70
        if !connection.token.isEmpty { request.setValue("Bearer " + connection.token, forHTTPHeaderField: "Authorization") }
        request.setValue(file == nil ? "application/json" : "application/octet-stream", forHTTPHeaderField: "Content-Type")
        if let key { request.setValue(key, forHTTPHeaderField: "Idempotency-Key") }
        request.httpBody = body
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForResource = 75
        config.urlCache = nil
        let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        let result: (Data, URLResponse)
        if let file {
            let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size > 0 && size <= 25 * 1024 * 1024 else { throw PrintError.message("Размер документа должен быть от 1 байта до 25 МБ") }
            result = try await session.upload(for: request, fromFile: file)
        } else { result = try await session.data(for: request) }
        guard let response = result.1 as? HTTPURLResponse, (200...299).contains(response.statusCode) else {
            let json = (try? JSONSerialization.jsonObject(with: result.0)) as? [String: Any]
            throw PrintError.message(json?["detail"] as? String ?? "Компьютер отклонил запрос. Проверьте подключение и параметры.")
        }
        return result.0
    }
    static func validatePairing(_ raw: String) throws -> [String: Any] {
        guard let data = raw.data(using: .utf8), let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let urlString = value["url"] as? String, let url = URL(string: urlString), url.scheme == "https", url.port == 9843,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil, url.path.isEmpty,
              let host = url.host, isLAN(host),
              let fingerprint = value["fingerprint"] as? String, fingerprint.range(of: "^[a-fA-F0-9]{64}$", options: .regularExpression) != nil,
              let code = value["code"] as? String, code.count >= 32 else { throw PrintError.message("Это не QR-код QuickPrint") }
        return value
    }
    static func isLAN(_ host: String) -> Bool {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4, parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy({ $0.isASCII && $0.isNumber }) }) else { return false }
        let octets = parts.compactMap { Int($0) }
        guard octets.count == 4, octets.allSatisfy({ (0...255).contains($0) }) else { return false }
        return octets[0] == 10 || (octets[0] == 192 && octets[1] == 168) || (octets[0] == 172 && (16...31).contains(octets[1]))
    }
}
