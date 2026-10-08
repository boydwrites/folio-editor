import AppKit
import WebKit
import Darwin

/// A local Mac host for the existing editor. The Python server belongs to this
/// app through an open control pipe; EOF stops it even if the host crashes.
@MainActor
final class FolioApp: NSObject, NSApplicationDelegate, NSWindowDelegate,
    WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var process: Process?
    private var control: Pipe?
    private var output = Data()
    private var origin: URL?
    private var quitting = false
    private var stopping = false
    private var mayQuit = false
    private var downloads = Set<ObjectIdentifier>()

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let url = Bundle.main.url(forResource: "Folio", withExtension: "icns"),
           let icon = NSImage(contentsOf: url) {
            NSApp.applicationIconImage = icon
        }
        makeMenu()
        let configuration = WKWebViewConfiguration()
        // A persistent store retains layout preferences across app launches.
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Folio"
        window.minSize = NSSize(width: 650, height: 500)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = webView
        window.setFrameAutosaveName("FolioWindow")
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        webView.loadHTMLString("<html><body style='font:18px system-ui;padding:48px;background:#f5f5ee;color:#16140f'><h1>Folio.</h1><p>Opening your writing…</p></body></html>", baseURL: nil)
        startServer()
    }

    private func makeMenu() {
        let menu = NSMenu()
        let app = NSMenuItem()
        let appMenu = NSMenu(title: "Folio")
        appMenu.addItem(withTitle: "About Folio", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Folio", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Folio", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        app.submenu = appMenu
        menu.addItem(app)
        let edit = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        for (title, action, key) in [("Undo", "undo:", "z"), ("Redo", "redo:", "Z"),
                                     ("Cut", "cut:", "x"), ("Copy", "copy:", "c"),
                                     ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        edit.submenu = editMenu
        menu.addItem(edit)
        let file = NSMenuItem()
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        file.submenu = fileMenu
        menu.addItem(file)
        NSApp.mainMenu = menu
    }

    private func startServer() {
        do {
            let data = try Data(contentsOf: Bundle.main.resourceURL!.appendingPathComponent("launcher.json"))
            let settings = try JSONSerialization.jsonObject(with: data) as! [String: String]
            let environment = ProcessInfo.processInfo.environment
            let repository = environment["FOLIO_PROJECT"] ?? settings["project"]!
            let python = environment["FOLIO_PYTHON"] ?? settings["python"]!
            guard FileManager.default.isExecutableFile(atPath: python),
                  FileManager.default.fileExists(atPath: repository + "/folio/launch.py") else {
                throw NSError(domain: "Folio", code: 1, userInfo: [NSLocalizedDescriptionKey:
                    "Folio could not find its local Python runtime or project. Rebuild Folio.app using Build Folio App.command in the project folder."])
            }
            let child = Process()
            let input = Pipe(), stdout = Pipe()
            child.executableURL = URL(fileURLWithPath: python)
            child.arguments = [repository + "/folio/launch.py", "--managed"]
            if let privateDirectory = environment["FOLIO_PRIVATE_DIR"] ?? settings["private"] {
                child.arguments! += ["--private-dir", privateDirectory, "--port", "0"]
            }
            child.currentDirectoryURL = URL(fileURLWithPath: repository)
            child.environment = environment
            child.standardInput = input
            child.standardOutput = stdout
            child.standardError = FileHandle.nullDevice
            control = input
            process = child
            stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                if data.isEmpty { handle.readabilityHandler = nil; return }
                DispatchQueue.main.async { self?.receive(data) }
            }
            child.terminationHandler = { [weak self] _ in
                DispatchQueue.main.async {
                    guard let self, !self.stopping, !self.mayQuit else { return }
                    // A structured startup error can arrive just before exit.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                        if !self.stopping && !self.mayQuit {
                            self.fail("The local Folio server stopped. Reopen Folio to continue. Your saved documents are preserved.")
                        }
                    }
                }
            }
            try child.run()
            input.fileHandleForReading.closeFile()
            stdout.fileHandleForWriting.closeFile()
            DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
                if let self, self.origin == nil && !self.stopping && !self.mayQuit {
                    self.fail("Folio took too long to start. Check its local Python runtime and reopen the app.")
                }
            }
        } catch { fail(error.localizedDescription) }
    }

    private func receive(_ data: Data) {
        output.append(data)
        while let newline = output.firstIndex(of: 10) {
            let line = output.prefix(upTo: newline)
            output.removeSubrange(...newline)
            guard let event = try? JSONSerialization.jsonObject(with: line) as? [String: String] else { continue }
            if event["event"] == "error" { fail(event["message"] ?? "Folio could not start."); return }
            if event["event"] == "ready", let value = event["url"], let url = URL(string: value),
               url.scheme == "http", url.host == "127.0.0.1", url.port != nil, !stopping {
                origin = url
                webView.load(URLRequest(url: url))
            }
        }
    }

    private func fail(_ message: String) {
        guard !mayQuit && !stopping else { return }
        let alert = NSAlert()
        alert.messageText = "Folio could not open"
        alert.informativeText = message
        alert.runModal()
        mayQuit = true
        stopServer { NSApp.terminate(nil) }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        return true
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        NSApp.terminate(nil)
        return false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if mayQuit { return .terminateNow }
        if quitting { return .terminateLater }
        quitting = true
        if !downloads.isEmpty {
            cancelQuit("Wait for the document export to finish, then quit again.")
            return .terminateCancel
        }
        webView.callAsyncJavaScript("return await window.FolioDesktop?.prepareToQuit() ?? true;",
                                  arguments: [:], in: nil, in: .page) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success:
                self.stopServer {
                    self.mayQuit = true
                    NSApp.reply(toApplicationShouldTerminate: true)
                }
            case .failure(let error):
                self.cancelQuit("Your writing could not finish saving. Folio stayed open.\n\n" + error.localizedDescription)
                NSApp.reply(toApplicationShouldTerminate: false)
            }
        }
        return .terminateLater
    }

    private func cancelQuit(_ message: String) {
        quitting = false
        let alert = NSAlert()
        alert.messageText = "Folio is still open"
        alert.informativeText = message
        alert.runModal()
    }

    private func stopServer(_ completion: @escaping () -> Void) {
        stopping = true
        control?.fileHandleForWriting.closeFile()
        control = nil
        guard let child = process, child.isRunning else { completion(); return }
        let start = Date()
        func waitForExit() {
            if !child.isRunning { completion(); return }
            let elapsed = Date().timeIntervalSince(start)
            if elapsed > 5 { kill(child.processIdentifier, SIGKILL) }
            else if elapsed > 2 { child.terminate() }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { waitForExit() }
        }
        waitForExit()
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.shouldPerformDownload && isLocal(url) { decisionHandler(.download) }
        else if isLocal(url) || url.absoluteString == "about:blank" { decisionHandler(.allow) }
        else { decisionHandler(.cancel) }
    }

    private func isLocal(_ url: URL) -> Bool {
        guard let origin else { return false }
        if url.scheme == "blob" { return url.absoluteString.hasPrefix("blob:" + origin.absoluteString + "/") }
        return url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        downloads.insert(ObjectIdentifier(download))
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.title = "Export document"
        panel.nameFieldStringValue = URL(fileURLWithPath: suggestedFilename).lastPathComponent
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { result in
            completionHandler(result == .OK ? panel.url : nil)
        }
    }

    func downloadDidFinish(_ download: WKDownload) { downloads.remove(ObjectIdentifier(download)) }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.remove(ObjectIdentifier(download))
        if (error as NSError).code == NSURLErrorCancelled { return }
        let alert = NSAlert()
        alert.messageText = "The export could not be saved"
        alert.informativeText = "Your document is still in Folio. Please export it again."
        alert.beginSheetModal(for: window)
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert(); alert.messageText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = message
        alert.addButton(withTitle: "OK"); alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { result in completionHandler(result == .alertFirstButtonReturn) }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // Reload only after informing the writer: WebKit may have lost an
        // unsaved edit when its renderer terminated.
        let alert = NSAlert()
        alert.messageText = "Folio’s editor stopped"
        alert.informativeText = "Reload to reopen your last saved writing. Any changes that had not saved may be lost."
        alert.addButton(withTitle: "Reload")
        alert.beginSheetModal(for: window) { _ in webView.reload() }
    }
}

@main
struct FolioMain {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = FolioApp()
        app.setActivationPolicy(.regular)
        app.delegate = delegate
        app.run()
    }
}
