// Ledger pour macOS : une fenêtre native (WebKit) qui démarre le serveur local embarqué
// (Node + server.mjs) et affiche l'interface. Les données restent dans ~/Library/Application Support/Ledger.
import Cocoa
import WebKit
import UniformTypeIdentifiers

let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev"
let repoURL = Bundle.main.infoDictionary?["LedgerRepositoryURL"] as? String ?? "https://github.com"
let dataDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Ledger")

// Bande invisible en haut de la fenêtre : la page occupe toute la fenêtre, on garde de quoi la déplacer.
final class DragStrip: NSView {
  override var mouseDownCanMoveWindow: Bool { true }
  override func mouseDown(with event: NSEvent) {
    if event.clickCount == 2 { window?.performZoom(nil) } else { window?.performDrag(with: event) }
  }
}

enum Probe { case ledger, free, busy }

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  var window: NSWindow!
  var webView: WKWebView!
  var server: Process?
  var baseURL: URL?

  // MARK: cycle de vie

  func applicationDidFinishLaunching(_ notification: Notification) {
    buildMenu()
    buildWindow()
    Task { @MainActor in
      do {
        let url = try await self.ensureServer()
        self.baseURL = url
        self.webView.load(URLRequest(url: url))
      } catch {
        self.showError(error.localizedDescription)
      }
    }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func applicationWillTerminate(_ notification: Notification) {
    guard let server, server.isRunning else { return }
    server.terminate() // SIGTERM : le serveur ferme proprement la base
    let deadline = Date().addingTimeInterval(2)
    while server.isRunning && Date() < deadline { usleep(50_000) }
  }

  // MARK: serveur

  func probe(_ port: Int) async -> Probe {
    let req = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/api/info")!, timeoutInterval: 0.8)
    do {
      let (data, _) = try await URLSession.shared.data(for: req)
      let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      return obj?["app"] as? String == "ledger" ? .ledger : .busy
    } catch let e as URLError where e.code == .cannotConnectToHost {
      return .free
    } catch {
      return .busy
    }
  }

  func nodeBinary() -> URL? {
    let bundled = Bundle.main.resourceURL!.appendingPathComponent("runtime/node")
    // Hors bundle (développement), on se rabat sur un Node installé.
    let candidates = [bundled.path, "/opt/homebrew/bin/node", "/usr/local/bin/node"]
    return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }.map { URL(fileURLWithPath: $0) }
  }

  func ensureServer() async throws -> URL {
    for port in 4747...4767 {
      switch await probe(port) {
      case .ledger:
        return URL(string: "http://127.0.0.1:\(port)/")! // un serveur Ledger tourne déjà sur la même base
      case .busy:
        continue
      case .free:
        try launchServer(port: port)
        for _ in 0..<80 {
          try await Task.sleep(nanoseconds: 125_000_000)
          if await probe(port) == .ledger { return URL(string: "http://127.0.0.1:\(port)/")! }
          if server?.isRunning == false { break }
        }
        throw NSError(domain: "Ledger", code: 2, userInfo: [NSLocalizedDescriptionKey: "Le serveur local n'a pas démarré. Détails dans \(logURL.path)"])
      }
    }
    throw NSError(domain: "Ledger", code: 1, userInfo: [NSLocalizedDescriptionKey: "Aucun port libre entre 4747 et 4767."])
  }

  var logURL: URL { dataDir.appendingPathComponent("logs/app.log") }

  func launchServer(port: Int) throws {
    guard let node = nodeBinary() else {
      throw NSError(domain: "Ledger", code: 3, userInfo: [NSLocalizedDescriptionKey: "Runtime Node introuvable dans l'application."])
    }
    let script = Bundle.main.resourceURL!.appendingPathComponent("app/server.mjs")
    try FileManager.default.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
    let log = try FileHandle(forWritingTo: logURL)
    log.seekToEndOfFile()

    let p = Process()
    p.executableURL = node
    p.arguments = [script.path, "--port", String(port), "--exit-with-parent"]
    p.currentDirectoryURL = script.deletingLastPathComponent()
    p.standardOutput = log
    p.standardError = log
    try p.run()
    server = p
  }

  // MARK: fenêtre

  func buildWindow() {
    let config = WKWebViewConfiguration()
    config.applicationNameForUserAgent = "LedgerMac/\(appVersion)"
    config.websiteDataStore = .default()

    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860),
                      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                      backing: .buffered, defer: false)
    window.title = "Ledger"
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    window.minSize = NSSize(width: 420, height: 520)
    window.backgroundColor = NSColor(name: nil) { appearance in
      appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        ? NSColor(srgbRed: 0.047, green: 0.063, blue: 0.071, alpha: 1)
        : NSColor(srgbRed: 0.933, green: 0.945, blue: 0.929, alpha: 1)
    }
    window.delegate = self
    window.center()
    window.setFrameAutosaveName("LedgerMainWindow")

    webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
    webView.autoresizingMask = [.width, .height]
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.setValue(false, forKey: "drawsBackground") // pas de flash blanc avant le chargement
    if #available(macOS 13.3, *) { webView.isInspectable = true }
    window.contentView!.addSubview(webView)

    let strip = DragStrip(frame: NSRect(x: 0, y: window.contentView!.bounds.height - 28, width: window.contentView!.bounds.width, height: 28))
    strip.autoresizingMask = [.width, .minYMargin]
    window.contentView!.addSubview(strip)

    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func windowDidEnterFullScreen(_ notification: Notification) { setFullscreenClass(true) }
  func windowDidExitFullScreen(_ notification: Notification) { setFullscreenClass(false) }
  func setFullscreenClass(_ on: Bool) {
    webView.evaluateJavaScript("document.documentElement.classList.toggle('fullscreen', \(on))")
  }

  func showError(_ message: String) {
    let esc = message.replacingOccurrences(of: "<", with: "&lt;")
    webView.loadHTMLString("""
      <html><body style="font:14px -apple-system;padding:60px;color:#536059;background:#eef1ed">
      <h2 style="color:#17201c">Ledger n'a pas pu démarrer</h2><p>\(esc)</p>
      <p>Tes données ne sont pas touchées. Quitte et relance l'application.</p></body></html>
      """, baseURL: nil)
  }

  // MARK: navigation : liens externes dans le navigateur, téléchargements via un panneau d'enregistrement

  func isLocal(_ url: URL?) -> Bool { url?.host == "127.0.0.1" || url?.host == "localhost" || url?.scheme == "about" }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, preferences: WKWebpagePreferences,
               decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
    if action.shouldPerformDownload { return decisionHandler(.download, preferences) }
    if let url = action.request.url, !isLocal(url), action.navigationType == .linkActivated {
      NSWorkspace.shared.open(url)
      return decisionHandler(.cancel, preferences)
    }
    decisionHandler(.allow, preferences)
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
               decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
    decisionHandler(disposition.contains("attachment") || !response.canShowMIMEType ? .download : .allow)
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                completionHandler: @escaping (URL?) -> Void) {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = suggestedFilename
    panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
    panel.beginSheetModal(for: window) { result in
      guard result == .OK, let url = panel.url else { return completionHandler(nil) }
      try? FileManager.default.removeItem(at: url) // le panneau a déjà demandé s'il fallait remplacer
      completionHandler(url)
    }
  }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url { NSWorkspace.shared.open(url) }
    return nil
  }

  // <input type="file"> (import JSON)
  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo,
               completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = false
    panel.allowedContentTypes = [.json]
    panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { retryLater() }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { retryLater() }
  func retryLater() {
    guard let baseURL else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.webView.load(URLRequest(url: baseURL)) }
  }

  // MARK: menus

  @objc func newTransaction() { webView.evaluateJavaScript("window.ledger && window.ledger.newTx()") }
  @objc func reload() { if let baseURL { webView.load(URLRequest(url: baseURL)) } }
  @objc func goSection(_ sender: NSMenuItem) {
    let views = ["dashboard", "ledger", "analytics", "subscriptions", "objectives", "investments", "settings"]
    webView.evaluateJavaScript("window.ledger && window.ledger.go('\(views[sender.tag])')")
  }
  @objc func openDataFolder() { NSWorkspace.shared.open(dataDir) }
  @objc func openRepo() { NSWorkspace.shared.open(URL(string: repoURL)!) }
  @objc func openInBrowser() { if let baseURL { NSWorkspace.shared.open(baseURL) } }
  @objc func showAbout() {
    NSApp.orderFrontStandardAboutPanel(options: [
      .credits: NSAttributedString(string: "Registre local pour suivre l'argent de plusieurs business.\nDonnées : ~/Library/Application Support/Ledger",
                                   attributes: [.font: NSFont.systemFont(ofSize: 11), .foregroundColor: NSColor.secondaryLabelColor]),
    ])
  }

  func buildMenu() {
    let main = NSMenu()
    func add(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
      let item = NSMenuItem(); let menu = NSMenu(title: title)
      items.forEach(menu.addItem); item.submenu = menu; main.addItem(item); return menu
    }
    func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
      let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
      i.keyEquivalentModifierMask = mods
      if let target { i.target = target }
      return i
    }

    _ = add("Ledger", [
      item("À propos de Ledger", #selector(showAbout), target: self),
      .separator(),
      item("Masquer Ledger", #selector(NSApplication.hide(_:)), "h"),
      item("Masquer les autres", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
      item("Tout afficher", #selector(NSApplication.unhideAllApplications(_:))),
      .separator(),
      item("Quitter Ledger", #selector(NSApplication.terminate(_:)), "q"),
    ])
    _ = add("Fichier", [
      item("Nouveau mouvement", #selector(newTransaction), "n", target: self),
      .separator(),
      item("Ouvrir dans le navigateur", #selector(openInBrowser), target: self),
      item("Afficher le dossier des données", #selector(openDataFolder), target: self),
      .separator(),
      item("Fermer", #selector(NSWindow.performClose(_:)), "w"),
    ])
    _ = add("Édition", [
      item("Annuler", Selector(("undo:")), "z"),
      item("Rétablir", Selector(("redo:")), "z", [.command, .shift]),
      .separator(),
      item("Couper", #selector(NSText.cut(_:)), "x"),
      item("Copier", #selector(NSText.copy(_:)), "c"),
      item("Coller", #selector(NSText.paste(_:)), "v"),
      item("Tout sélectionner", #selector(NSText.selectAll(_:)), "a"),
    ])
    let sections = ["Tableau de bord", "Grand livre", "Analyse", "Abonnements", "Objectifs", "Investissements", "Réglages"]
    var viewItems = sections.enumerated().map { i, title -> NSMenuItem in
      let m = item(title, #selector(goSection(_:)), String(i + 1), target: self); m.tag = i; return m
    }
    viewItems += [.separator(), item("Recharger", #selector(reload), "r", target: self),
                  item("Plein écran", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])]
    _ = add("Présentation", viewItems)
    let windowMenu = add("Fenêtre", [
      item("Placer dans le Dock", #selector(NSWindow.performMiniaturize(_:)), "m"),
      item("Réduire / agrandir", #selector(NSWindow.performZoom(_:))),
    ])
    NSApp.windowsMenu = windowMenu
    _ = add("Aide", [item("Ledger sur GitHub", #selector(openRepo), target: self)])
    NSApp.mainMenu = main
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
