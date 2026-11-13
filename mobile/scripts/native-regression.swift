import Foundation

@main struct Regression {
    static func main() throws {
        let group = "group.app.quickprint.mobile"
        precondition(SharedStore.candidates(configured: group, signed: [group + ".TEAM"]) == [group + ".TEAM", group])
        precondition(SharedStore.candidates(configured: group, signed: []) == [group])
        precondition(SharedStore.candidates(configured: group, signed: [group, group]) == [group])
        precondition(SharedStore.candidates(configured: group, signed: ["group.unrelated", "group.other"]) == [group])
        precondition(SharedStore.candidates(configured: group, signed: ["group.resigned"]) == ["group.resigned", group])
        let plist = try PropertyListSerialization.data(fromPropertyList: ["Entitlements": ["com.apple.security.application-groups": [group + ".TEAM"]]], format: .xml, options: 0)
        precondition(SharedStore.provisionGroups(Data([0, 1, 2]) + plist + Data([3])) == [group + ".TEAM"])
        precondition(SharedStore.provisionGroups(Data("invalid".utf8)).isEmpty)
        for ip in ["10.0.0.1", "192.168.0.213", "172.16.0.1", "172.31.255.255"] { precondition(PrintClient.isLAN(ip)) }
        for ip in ["8.8.8.8", "127.0.0.1", "172.32.0.1", "192.168.256.1", "10..0.0.1", "10.0.0.1.extra", "+10.0.0.1"] { precondition(!PrintClient.isLAN(ip)) }
        func qr(_ url: String, fingerprint: String = String(repeating: "a", count: 64), code: String = String(repeating: "b", count: 32)) throws -> String {
            String(decoding: try JSONSerialization.data(withJSONObject: ["url": url, "fingerprint": fingerprint, "code": code]), as: UTF8.self)
        }
        _ = try PrintClient.validatePairing(qr("https://192.168.0.213:9843"))
        for url in ["http://192.168.0.1:9843", "https://8.8.8.8:9843", "https://192.168.0.1:443", "https://user@192.168.0.1:9843", "https://192.168.0.1:9843/path", "https://192.168.0.1:9843?x=1"] {
            do { _ = try PrintClient.validatePairing(qr(url)); fatalError("Accepted invalid QR: \(url)") } catch {}
        }
        do { _ = try PrintClient.validatePairing(qr("https://192.168.0.1:9843", fingerprint: "bad")); fatalError("Accepted bad fingerprint") } catch {}
        do { _ = try PrintClient.validatePairing(qr("https://192.168.0.1:9843", code: "short")); fatalError("Accepted short code") } catch {}
        print("PASS: native App Group resolution, provisioning metadata, LAN restrictions and QR validation")
    }
}
