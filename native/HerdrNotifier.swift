import AppKit
import Darwin
import Foundation

private struct Request {
    let title: String
    let body: String
    let identifier: String

    static func parse(_ arguments: [String]) -> Request? {
        guard arguments.count > 1 else { return nil }
        let mode = arguments[1]
        guard mode == "--test" || mode == "--notify" else { return nil }

        var values: [String: String] = [:]
        var index = 2
        while index + 1 < arguments.count {
            let key = arguments[index]
            guard key.hasPrefix("--") else { return nil }
            values[String(key.dropFirst(2))] = arguments[index + 1]
            index += 2
        }

        guard let title = values["title"], !title.isEmpty,
              let body = values["body"], !body.isEmpty else {
            return nil
        }

        return Request(
            title: String(title.prefix(120)),
            body: String(body.prefix(240)),
            identifier: String((values["identifier"] ?? UUID().uuidString).prefix(160))
        )
    }
}

private final class HerdrNotifierApp: NSObject, NSApplicationDelegate {
    private let request: Request

    init(request: Request) {
        self.request = request
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let alert = NSUserNotification()
        alert.title = request.title
        alert.informativeText = request.body
        alert.identifier = request.identifier
        // Herdr App already plays its own done/blocked sounds.
        alert.soundName = nil
        NSUserNotificationCenter.default.deliver(alert)

        print("notification submitted to Notification Center")
        fflush(stdout)
        // Allow the system notification service to accept the request before
        // this short-lived accessory app exits.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            NSApp.terminate(nil)
        }
    }
}

@main
private enum Main {
    static func main() {
        guard let request = Request.parse(CommandLine.arguments) else {
            FileHandle.standardError.write(Data(
                "Usage: HerdrNotifier (--test|--notify) --title TEXT --body TEXT [--identifier ID]\n".utf8
            ))
            Darwin.exit(EXIT_FAILURE)
        }

        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let delegate = HerdrNotifierApp(request: request)
        app.delegate = delegate
        app.run()
    }
}
