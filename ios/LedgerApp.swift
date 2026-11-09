// Ledger pour iPhone : l'interface et le moteur (base SQLite, calculs, synchro) tournent dans une WKWebView,
// servie depuis les fichiers de l'app sous ledger://app/. Comme l'app Android, ce code ne fournit que ce qu'une
// page web ne sait pas faire : fichiers privés, recherche du Mac sur le Wi-Fi, requêtes vers le Mac,
// exports, couleur des barres. Le pont JavaScript est dans ios/web/native-bridge.js.
import UIKit
import WebKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ app: UIApplication, configurationForConnecting session: UISceneSession, options _: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: nil, sessionRole: session.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo _: UISceneSession, options _: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        window = UIWindow(windowScene: scene)
        window?.rootViewController = LedgerViewController()
        window?.makeKeyAndVisible()
    }

    // En arrière-plan : la base est enregistrée tout de suite, avec un peu de temps accordé par iOS.
    func sceneDidEnterBackground(_: UIScene) {
        let app = UIApplication.shared
        let task = Box(UIBackgroundTaskIdentifier.invalid)
        task.value = app.beginBackgroundTask { app.endBackgroundTask(task.value) }
        (window?.rootViewController as? LedgerViewController)?.flush { app.endBackgroundTask(task.value) }
    }
}

#if DEBUG
final class ConsoleLog: NSObject, WKScriptMessageHandler {
    func userContentController(_: WKUserContentController, didReceive m: WKScriptMessage) { NSLog("[page] %@", "\(m.body)") }
}
#endif

final class Box<T> { var value: T; init(_ v: T) { value = v } }

final class LedgerViewController: UIViewController, WKUIDelegate, WKNavigationDelegate {
    private var web: WKWebView!
    private var lightBars = false
    private let root: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Ledger", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var u = dir
        var v = URLResourceValues()
        v.isExcludedFromBackup = true // rien n'est envoyé dans la sauvegarde iCloud
        try? u.setResourceValues(v)
        return dir
    }()

    override var preferredStatusBarStyle: UIStatusBarStyle { lightBars ? .darkContent : .lightContent }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(AssetHandler(), forURLScheme: "ledger")
        #if DEBUG // erreurs et console de la page dans le journal (xcrun simctl spawn booted log stream)
        config.userContentController.add(ConsoleLog(), name: "log")
        config.userContentController.addUserScript(WKUserScript(source: """
            for (const k of ["log", "warn", "error"]) { const o = console[k]; console[k] = (...a) => { try { webkit.messageHandlers.log.postMessage(k + ": " + a.map(String).join(" ")); } catch {} o(...a); }; }
            addEventListener("error", (e) => webkit.messageHandlers.log.postMessage("error: " + e.message + " @ " + e.filename + ":" + e.lineno));
            addEventListener("unhandledrejection", (e) => webkit.messageHandlers.log.postMessage("rejection: " + (e.reason && e.reason.stack || e.reason)));
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        #endif
        config.applicationNameForUserAgent = "LedgerIOS/\(Self.version)" // reconnu par l'interface
        web = WKWebView(frame: .zero, configuration: config)
        web.uiDelegate = self
        web.navigationDelegate = self
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 0x0d / 255, green: 0x11 / 255, blue: 0x13 / 255, alpha: 1)
        web.scrollView.contentInsetAdjustmentBehavior = .never // l'interface gère elle-même les zones sûres
        web.load(URLRequest(url: URL(string: "ledger://app/index.html")!))
        #if DEBUG
        if #available(iOS 16.4, *) { web.isInspectable = true }
        #endif
        view = web
    }

    #if DEBUG
    // LEDGER_SELFTEST=1 : cherche le Mac au démarrage et écrit le résultat dans le journal.
    func webView(_ w: WKWebView, didFinish _: WKNavigation!) {
        guard ProcessInfo.processInfo.environment["LEDGER_SELFTEST"] != nil else { return }
        w.evaluateJavaScript("fetch('/api/sync/discover').then(r => r.text()).then(t => { console.log('discover ' + t); const h = JSON.parse(t)[0]; return h && fetch(h.url + '/sync', { method: 'POST', body: 'x' }).then(async r => console.log('http ' + r.status + ' ' + await r.text())); }).catch(e => console.error('selftest ' + e))")
    }
    #endif

    static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?" }

    func flush(_ done: @escaping () -> Void) {
        web.evaluateJavaScript("window.ledgerFlush && ledgerFlush()") { _, _ in done() }
    }

    private func js(_ code: String) { DispatchQueue.main.async { self.web.evaluateJavaScript(code) } }
    private func resolve(_ id: String, _ value: Any) {
        let json = String(data: (try? JSONSerialization.data(withJSONObject: value)) ?? Data("null".utf8), encoding: .utf8)!
        let arg = String(data: try! JSONSerialization.data(withJSONObject: [id, json]), encoding: .utf8)!
        js("window.__ledgerNativeResolve(...\(arg))")
    }

    // ---------- navigation : les liens externes s'ouvrent dans Safari ----------
    func webView(_ w: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, url.scheme != "ledger", url.scheme != "about" else { return decisionHandler(.allow) }
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame _: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }

    func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame _: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Annuler", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }

    // ---------- pont : prompt("ledger-native", JSON [méthode, ...arguments]) ----------
    func webView(_ w: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame _: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        guard prompt == "ledger-native", let data = defaultText?.data(using: .utf8),
              let args = try? JSONSerialization.jsonObject(with: data) as? [Any], let method = args.first as? String else {
            let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            a.addTextField { $0.text = defaultText }
            a.addAction(UIAlertAction(title: "Annuler", style: .cancel) { _ in completionHandler(nil) })
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(a.textFields?.first?.text) })
            return present(a, animated: true)
        }
        let result = call(method, Array(args.dropFirst())) ?? NSNull()
        completionHandler(String(data: (try? JSONSerialization.data(withJSONObject: result, options: .fragmentsAllowed)) ?? Data("null".utf8), encoding: .utf8))
    }

    private func call(_ method: String, _ a: [Any]) -> Any? {
        let s = { (i: Int) in a.count > i ? a[i] as? String ?? "" : "" }
        let n = { (i: Int) in a.count > i ? (a[i] as? NSNumber)?.intValue ?? 0 : 0 }
        let fm = FileManager.default
        switch method {
        case "readFile":
            guard let f = file(s(0)), let d = try? Data(contentsOf: f) else { return nil }
            return d.base64EncodedString()
        case "writeFile":
            guard let f = file(s(0)), let d = Data(base64Encoded: s(1)) else { return false }
            try? fm.createDirectory(at: f.deletingLastPathComponent(), withIntermediateDirectories: true)
            return (try? d.write(to: f, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])) != nil // remplacement atomique
        case "exists":
            return file(s(0)).map { fm.fileExists(atPath: $0.path) } ?? false
        case "mkdirs":
            guard let f = file(s(0)) else { return false }
            return (try? fm.createDirectory(at: f, withIntermediateDirectories: true)) != nil
        case "remove":
            guard let f = file(s(0)) else { return false }
            if (a.count > 1 ? a[1] as? Bool : nil) == true { return (try? fm.removeItem(at: f)) != nil }
            return unlink(f.path) == 0 || rmdir(f.path) == 0
        case "list":
            guard let f = file(s(0)), let names = try? fm.contentsOfDirectory(atPath: f.path) else { return nil }
            let list = names.filter { !$0.hasSuffix(".tmp") && !$0.hasPrefix(".") }
            return String(data: try! JSONSerialization.data(withJSONObject: list), encoding: .utf8)
        case "stat":
            guard let f = file(s(0)), let at = try? fm.attributesOfItem(atPath: f.path) else { return nil }
            let info: [String: Any] = [
                "size": (at[.size] as? NSNumber)?.intValue ?? 0,
                "mtime": Int(((at[.modificationDate] as? Date) ?? Date()).timeIntervalSince1970 * 1000),
                "dir": (at[.type] as? FileAttributeType) == .typeDirectory,
            ]
            return String(data: try! JSONSerialization.data(withJSONObject: info), encoding: .utf8)
        case "rename":
            guard let from = file(s(0)), let to = file(s(1)) else { return false }
            return Foundation.rename(from.path, to.path) == 0
        case "copy":
            guard let from = file(s(0)), let to = file(s(1)), let d = try? Data(contentsOf: from) else { return false }
            return (try? d.write(to: to, options: .atomic)) != nil
        case "deviceName":
            return UIDevice.current.name
        case "discover":
            discover(id: s(0), port: n(1), timeout: n(2))
            return nil
        case "http":
            http(id: s(0), url: s(1), method: s(2), body: s(3))
            return nil
        case "saveDownload":
            return saveDownload(name: s(0), b64: s(2))
        case "setBars":
            setBars(s(0))
            return nil
        default:
            return nil
        }
    }

    private func file(_ path: String) -> URL? {
        if path.isEmpty || path.split(separator: "/").contains("..") { return nil }
        return root.appendingPathComponent(path.hasPrefix("/") ? String(path.dropFirst()) : path)
    }

    /// Requête vers l'autre appareil (synchro), en dehors de la page. Répond {status, body} ou {error}.
    private func http(id: String, url: String, method: String, body: String) {
        guard let u = URL(string: url) else { return resolve(id, ["error": "Adresse invalide."]) }
        var req = URLRequest(url: u, timeoutInterval: 20)
        req.httpMethod = method
        if method != "GET" && method != "HEAD" {
            req.httpBody = Data(body.utf8)
            req.setValue("text/plain", forHTTPHeaderField: "Content-Type")
        }
        URLSession(configuration: .ephemeral).dataTask(with: req) { [weak self] data, res, err in
            if let err { self?.resolve(id, ["error": err.localizedDescription]); return }
            let status = (res as? HTTPURLResponse)?.statusCode ?? 502
            self?.resolve(id, ["status": status, "body": String(decoding: data ?? Data(), as: UTF8.self)])
        }.resume()
    }

    /// Cherche les Mac Ledger sur le Wi-Fi. iOS réserve la diffusion (broadcast) aux apps qui en ont reçu le
    /// droit d'Apple : la question est donc envoyée à chaque adresse du réseau local, une par une.
    private func discover(id: String, port: Int, timeout: Int) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var found: [[String: String]] = []
            let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
            if fd >= 0 {
                var on: Int32 = 1
                setsockopt(fd, SOL_SOCKET, SO_BROADCAST, &on, socklen_t(MemoryLayout<Int32>.size))
                var tv = timeval(tv_sec: 0, tv_usec: 150_000)
                setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
                let targets = Self.localTargets()
                let ask = Array("LEDGER?".utf8)
                let start = Date(), end = start.addingTimeInterval(Double(timeout) / 1000)
                let sends = [0.0, 0.3, 0.8]
                var sent = 0
                var buf = [UInt8](repeating: 0, count: 512)
                while Date() < end {
                    if sent < sends.count && Date().timeIntervalSince(start) >= sends[sent] {
                        for ip in targets {
                            var sa = sockaddr_in()
                            sa.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
                            sa.sin_family = sa_family_t(AF_INET)
                            sa.sin_port = in_port_t(UInt16(port).bigEndian)
                            sa.sin_addr = in_addr(s_addr: ip.bigEndian)
                            _ = withUnsafePointer(to: &sa) {
                                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { sendto(fd, ask, ask.count, 0, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
                            }
                        }
                        sent += 1
                    }
                    var from = sockaddr_in()
                    var len = socklen_t(MemoryLayout<sockaddr_in>.size)
                    let got = withUnsafeMutablePointer(to: &from) {
                        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { recvfrom(fd, &buf, buf.count, 0, $0, &len) }
                    }
                    if got > 0 {
                        var addr = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
                        var a = from.sin_addr
                        inet_ntop(AF_INET, &a, &addr, socklen_t(INET_ADDRSTRLEN))
                        let address = String(cString: addr), msg = String(decoding: buf[0 ..< got], as: UTF8.self)
                        if !found.contains(where: { $0["address"] == address && $0["msg"] == msg }) { found.append(["msg": msg, "address": address]) }
                    }
                }
                close(fd)
            }
            self?.resolve(id, found)
        }
    }

    /// Adresses IPv4 du Wi-Fi, plus les adresses de diffusion au cas où elles passent.
    private static func localTargets() -> [UInt32] {
        var targets: [UInt32] = [0xFFFF_FFFF]
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return targets }
        defer { freeifaddrs(list) }
        for p in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let i = p.pointee
            guard let sa = i.ifa_addr, sa.pointee.sa_family == sa_family_t(AF_INET), let nm = i.ifa_netmask,
                  (i.ifa_flags & UInt32(IFF_UP)) != 0, (i.ifa_flags & UInt32(IFF_LOOPBACK)) == 0,
                  String(cString: i.ifa_name).hasPrefix("en") else { continue }
            let ip = sa.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { UInt32(bigEndian: $0.pointee.sin_addr.s_addr) }
            var mask = nm.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { UInt32(bigEndian: $0.pointee.sin_addr.s_addr) }
            if mask < 0xFFFF_FC00 { mask = 0xFFFF_FF00 } // grand réseau : on se limite aux 254 voisins
            let net = ip & mask, bcast = net | ~mask
            targets.append(bcast)
            if net + 1 < bcast { for host in (net + 1) ..< bcast { targets.append(host) } }
        }
        return targets
    }

    /// Export : feuille de partage iOS (Enregistrer dans Fichiers, AirDrop, Mail…).
    private func saveDownload(name: String, b64: String) -> String {
        guard let data = Data(base64Encoded: b64) else { return "Données invalides" }
        let safe = name.replacingOccurrences(of: "/", with: "-")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(safe)
        do { try data.write(to: url, options: .atomic) } catch { return error.localizedDescription }
        DispatchQueue.main.async {
            let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            share.popoverPresentationController?.sourceView = self.view
            share.popoverPresentationController?.sourceRect = CGRect(x: self.view.bounds.midX, y: self.view.bounds.maxY - 40, width: 1, height: 1)
            self.present(share, animated: true)
        }
        return ""
    }

    /// Fond et barre d'état de la couleur du fond de l'app : "rgb(r, g, b)".
    private func setBars(_ css: String) {
        let nums = css.split(whereSeparator: { !$0.isNumber }).prefix(3).compactMap { Double($0) }
        guard nums.count == 3 else { return }
        let color = UIColor(red: nums[0] / 255, green: nums[1] / 255, blue: nums[2] / 255, alpha: 1)
        lightBars = 0.299 * nums[0] + 0.587 * nums[1] + 0.114 * nums[2] > 150
        web.backgroundColor = color
        web.scrollView.backgroundColor = color
        setNeedsStatusBarAppearanceUpdate()
    }
}

/// Sert les fichiers de l'app (dossier www du paquet) sous ledger://app/.
final class AssetHandler: NSObject, WKURLSchemeHandler {
    private static let mime = ["html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8",
                               "json": "application/json; charset=utf-8", "png": "image/png", "svg": "image/svg+xml",
                               "wasm": "application/wasm", "ico": "image/x-icon"]
    private let www = Bundle.main.resourceURL!.appendingPathComponent("www")

    func webView(_ w: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = www.appendingPathComponent(String(path.dropFirst()))
        let ok = !path.split(separator: "/").contains("..")
        guard ok, let data = try? Data(contentsOf: file) else {
            task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: [:])!)
            task.didReceive(Data())
            return task.didFinish()
        }
        let type = Self.mime[file.pathExtension] ?? "application/octet-stream"
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                        headerFields: ["Content-Type": type, "Content-Length": "\(data.count)", "Cache-Control": "no-cache"])!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ w: WKWebView, stop _: WKURLSchemeTask) {}
}
