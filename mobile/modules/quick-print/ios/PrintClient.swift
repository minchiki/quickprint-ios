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
    static var root: URL {
        get throws {
            // AltStore rewrites App Group identifiers during personal signing and
            // exposes the signed identifiers in ALTAppGroups for both targets.
            let signedGroups = Bundle.main.object(forInfoDictionaryKey: "ALTAppGroups") as? [String] ?? []
            let candidates = [group] + signedGroups.filter { $0 == group || $0.hasPrefix(group + ".") }
            for candidate in candidates {
                if let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: candidate) { return url }
            }
            throw PrintError.message("Общий контейнер недоступен. При установке сохраните расширение QuickPrint и его App Group.")
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
        let octets = host.split(separator: ".").compactMap { Int($0) }
        guard octets.count == 4, octets.allSatisfy({ (0...255).contains($0) }) else { return false }
        return octets[0] == 10 || (octets[0] == 192 && octets[1] == 168) || (octets[0] == 172 && (16...31).contains(octets[1]))
    }
}
