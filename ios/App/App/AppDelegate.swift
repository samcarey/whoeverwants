import UIKit
import Capacitor
import UserNotifications
import AppIntents
import Security

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // UIWindow's default backgroundColor is black; if the WebView's
        // frame doesn't fully cover the window (e.g. iOS reserving the
        // home-indicator zone), the window bg shows through as a black bar.
        // Use `.systemBackground` so the leak adapts to light/dark, matching
        // the page's `prefers-color-scheme`-aware background.
        window?.backgroundColor = .systemBackground
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // @capacitor/push-notifications requires the AppDelegate to forward
    // iOS's APNS callbacks into the plugin via NotificationCenter. Without
    // these two methods, `PushNotifications.register()` succeeds on the
    // device but the `registration` event never fires in JS — manifesting
    // as a 60s timeout in `bootstrapCapacitorPushSubscription`. The plugin
    // doesn't auto-install method swizzles, so this hand-wiring is the
    // documented one-time setup (per the plugin README's iOS section).
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

}

// CAPBridgeViewController.loadView() is `final` and assigns
// `view = webView`, so we can't override the view hierarchy or root
// view's class — only react in viewDidLoad. Belt-and-suspenders against
// any case where the WebView's frame doesn't fully cover the window
// (Capacitor config not yet parsed, frame-vs-window mismatch, etc.):
// pin the view to `.systemBackground` so any leak reads as page bg
// instead of UIWindow's default black. Capacitor's own setup also
// writes `webView.backgroundColor` + `scrollView.backgroundColor` from
// `capacitor.config.ts` (CAPBridgeViewController.swift L308-310), so
// don't redo those — the view is the only layer this VC owns that
// isn't covered by the config.
//
// Colocated with AppDelegate because adding a new .swift file requires
// hand-patching project.pbxproj (the headless CI build has no Xcode GUI
// to handle the file-add flow); class is small enough that splitting
// pays no readability dividend.
class MainViewController: CAPBridgeViewController {
    override open func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
    }
}

// Custom Capacitor plugin: peek at a copied web URL WITHOUT triggering iOS's
// "Pasted from <app>" banner. `Clipboard.read()` (UIPasteboard.general.string)
// forces that banner on every read, before JS can inspect the content. iOS 16's
// pasteboard *detection* API (`detectValues`) is privacy-preserving: it returns
// the matched URL silently, so JS can check the domain and only surface our own
// "open link?" modal for actual whoeverwants links. On iOS < 16 detectValues is
// unavailable, so we report `supported: false` and JS skips the auto-check
// entirely rather than fall back to a banner-triggering read.
//
// Colocated in AppDelegate.swift for the same reason MainViewController is:
// a new .swift file means hand-patching project.pbxproj in the headless CI
// build. Capacitor auto-discovers CAPBridgedPlugin conformers at runtime, so
// no project.pbxproj or cap-config change is needed beyond compiling this class.
@objc(ClipboardUrlPlugin)
public class ClipboardUrlPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ClipboardUrlPlugin"
    public let jsName = "ClipboardUrl"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "detectUrl", returnType: CAPPluginReturnPromise)
    ]

    @objc func detectUrl(_ call: CAPPluginCall) {
        if #available(iOS 16.0, *) {
            UIPasteboard.general.detectValues(for: [.probableWebURL]) { result in
                var resolved: String? = nil
                if case .success(let values) = result {
                    if let url = values[.probableWebURL] as? URL {
                        resolved = url.absoluteString
                    } else if let str = values[.probableWebURL] as? String {
                        resolved = str
                    }
                }
                if let urlString = resolved {
                    call.resolve(["supported": true, "url": urlString])
                } else {
                    call.resolve(["supported": true])
                }
            }
        } else {
            call.resolve(["supported": false])
        }
    }
}

// Custom Capacitor plugin: set the iOS app-icon badge number from the WebView.
// The Web Badging API (`navigator.setAppBadge` / `clearAppBadge`) is NOT exposed
// inside WKWebView, so without this plugin the native badge can only be SET by
// APNS `aps.badge` and can never be cleared or resynced from within the app — a
// stale badge (e.g. a "1" left over from a prior push, or preserved across a
// TestFlight app update, which iOS keeps on the icon) sticks forever, even for a
// signed-out user with no groups whose true count is 0. `lib/pushNotifications.ts`
// drives this on app open / focus via the existing `refreshAppBadge` resync, which
// computes the true count server-side and applies it here.
//
// Colocated in AppDelegate.swift for the same reason MainViewController /
// ClipboardUrlPlugin are: a new .swift file means hand-patching project.pbxproj
// in the headless CI build. Capacitor auto-discovers CAPBridgedPlugin conformers
// at runtime, so no project.pbxproj or cap-config change is needed beyond
// compiling this class.
@objc(AppBadgePlugin)
public class AppBadgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppBadgePlugin"
    public let jsName = "AppBadge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setBadge", returnType: CAPPluginReturnPromise)
    ]

    @objc func setBadge(_ call: CAPPluginCall) {
        let count = max(0, call.getInt("count") ?? 0)
        // UIApplication.shared must be touched on the main thread; plugin calls
        // arrive on a background queue. Clearing (count 0) works regardless of
        // notification authorization; setting > 0 needs the `.badge` permission,
        // which the push bootstrap requests.
        DispatchQueue.main.async {
            if #available(iOS 16.0, *) {
                UNUserNotificationCenter.current().setBadgeCount(count)
            } else {
                UIApplication.shared.applicationIconBadgeNumber = count
            }
            call.resolve()
        }
    }
}

// Phase 2 of docs/siri-integration-plan.md — native identity bridge.
//
// The WebView keeps the user's identity in localStorage
// (`lib/session.ts: session_token`, `lib/browserIdentity.ts: browser_id`,
// `lib/userProfile.ts: whoeverwants_user_name`), which native Swift cannot
// see. This Keychain store is the bridge: `lib/nativeIdentity.ts` pushes the
// current triple here whenever the session changes, so native code — and the
// future in-process headless-creation App Intent (Phase 3) — can make API
// calls *as the user* (Authorization: Bearer <token> + X-Browser-Id, with
// creator_name from the display name the server requires).
//
// Storage posture: kSecClassGenericPassword with accessibility
// kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly — readable by a background
// App Intent after the first unlock, but NOT synced to iCloud and NOT migrated
// to a new device on restore (a bearer token shouldn't travel). This is a
// stronger posture than WebView localStorage, which the OS does not encrypt at
// rest the same way. The service is namespaced per bundle id so the prod and
// canary apps don't share a Keychain item.
//
// Plain Keychain (no App Group / kSecAttrAccessGroup) because Phase 3 starts as
// an IN-PROCESS intent (the plan's "start in-process to avoid the pipeline
// cost" decision) — an App Group would only be required if a SEPARATE extension
// target had to read these, which also needs a one-time Apple Developer portal
// entitlement. If Phase 3 ever moves to an extension, add the access group here
// + the entitlement on both bundles.
private enum NativeIdentityKeychain {
    static let service = (Bundle.main.bundleIdentifier ?? "com.whoeverwants.app") + ".identity"
    static let tokenAccount = "session_token"
    static let browserIdAccount = "browser_id"
    static let nameAccount = "display_name"

    private static func baseQuery(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    // Upsert when a non-empty value is provided; a nil / empty value DELETES the
    // item (so the JS side can express "the token is gone" by passing null).
    static func set(_ account: String, _ value: String?) {
        guard let value = value, !value.isEmpty, let data = value.data(using: .utf8) else {
            delete(account)
            return
        }
        let attrs: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(baseQuery(account) as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            var insert = baseQuery(account)
            insert.merge(attrs) { _, new in new }
            SecItemAdd(insert as CFDictionary, nil)
        }
    }

    static func get(_ account: String) -> String? {
        var query = baseQuery(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let str = String(data: data, encoding: .utf8) else {
            return nil
        }
        return str
    }

    static func delete(_ account: String) {
        SecItemDelete(baseQuery(account) as CFDictionary)
    }
}

// Custom Capacitor plugin: write/read the WebView's identity to/from the
// Keychain (see NativeIdentityKeychain above). `setIdentity` is driven by
// `lib/nativeIdentity.ts` on every session change (sign-out passes a null
// token + null name, so it doubles as the clear path); `getIdentity` lets
// native code (and an on-device round-trip check) read it back.
//
// Colocated in AppDelegate.swift for the same reason MainViewController /
// ClipboardUrlPlugin / AppBadgePlugin are: a new .swift file means hand-patching
// project.pbxproj in the headless CI build. Capacitor auto-discovers
// CAPBridgedPlugin conformers at runtime — no project.pbxproj or cap-config
// change is needed beyond compiling this class. Keychain APIs need no
// `@available` gate (available on every supported iOS), unlike the iOS-18
// OpenURLIntent below.
@objc(NativeIdentityPlugin)
public class NativeIdentityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeIdentityPlugin"
    public let jsName = "NativeIdentity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setIdentity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getIdentity", returnType: CAPPluginReturnPromise),
    ]

    // The JS side passes the FULL current triple every call, so a null token +
    // null name with a non-null browser id (the sign-out shape) clears the
    // secret while keeping the persistent browser id. `call.getString` returns
    // nil for both an absent key and an explicit JSON null; `set` treats nil /
    // "" as a delete.
    @objc func setIdentity(_ call: CAPPluginCall) {
        NativeIdentityKeychain.set(NativeIdentityKeychain.tokenAccount, call.getString("token"))
        NativeIdentityKeychain.set(NativeIdentityKeychain.browserIdAccount, call.getString("browserId"))
        NativeIdentityKeychain.set(NativeIdentityKeychain.nameAccount, call.getString("name"))
        call.resolve()
    }

    @objc func getIdentity(_ call: CAPPluginCall) {
        var result: [String: Any] = [:]
        if let t = NativeIdentityKeychain.get(NativeIdentityKeychain.tokenAccount) { result["token"] = t }
        if let b = NativeIdentityKeychain.get(NativeIdentityKeychain.browserIdAccount) { result["browserId"] = b }
        if let n = NativeIdentityKeychain.get(NativeIdentityKeychain.nameAccount) { result["name"] = n }
        call.resolve(result)
    }
}

// App Intents — expose "create a poll" to Siri / Shortcuts / Spotlight.
//
// Phase 1 of docs/siri-integration-plan.md: a deep-link intent that opens the
// app to the existing create-poll flow with the spoken prompt prefilled as the
// poll title. There is NO native poll logic and NO auth bridge here — the
// WebView stays the source of truth; the user reviews + submits in the normal
// create modal, and the server creates the poll exactly as for a manual one.
//
// Mechanism: `openAppWhenRun` foregrounds the app, then `OpenURLIntent` opens a
// universal link to our own host. iOS routes it back into the (now-foreground)
// app — the `applinks:` entitlement claims the host — Capacitor fires
// `appUrlOpen`, and `lib/universalLinks.ts` router.pushes
// `/g/?create=1&title=<spoken text>`, which `app/create-poll/page.tsx` consumes
// to open + prefill the create modal. The web half is live the moment the
// branch deploys to its tier host; only this Swift half needs a fresh iOS build.
//
// Per-tier host: the prod bundle (`com.whoeverwants.app`) loads
// whoeverwants.com; the canary bundle (`com.whoeverwants.app.latest`) loads
// latest.whoeverwants.com — mirroring capacitor.config.ts / CAP_ENV. The
// universal-link routing only fires for the host the app actually loads, so the
// per-bundle host selection is load-bearing.
//
// Colocated in AppDelegate.swift for the same reason the plugins are: a new
// .swift file means hand-patching project.pbxproj in the headless CI build.
// `AppShortcutsProvider` + `AppIntent` are auto-discovered by iOS at build/run
// time (no Info.plist key, no portal capability, no pbxproj change).
//
// Availability: gated at iOS 18 because `OpenURLIntent` — the loopback-correct
// way for an App Intent to open the app's OWN universal link — is iOS 18+. App
// Intents themselves are iOS 16+, but the pre-18 alternatives are worse here
// (`UIApplication.open` of your own universal link from within the app opens
// Safari rather than looping back; a custom URL scheme would add Info.plist +
// CI + JS-routing surface). The shortcut is purely additive, so iOS 16–17 users
// simply don't see it. The deployment floor is iOS 15; the rest of the app
// gates iOS-16-only behavior the same `@available` way (Clipboard/AppBadge).
// If broader reach is wanted later, switch to a custom URL scheme (documented
// follow-up in docs/siri-integration-plan.md).
@available(iOS 18.0, *)
struct CreatePollIntent: AppIntent {
    static var title: LocalizedStringResource = "Create a poll"
    // Foreground the app; creation happens in the WebView, not natively.
    static var openAppWhenRun = true

    // Required free-text parameter. When the user invokes the intent without
    // speaking the question, App Intents asks `requestValueDialog` and accepts
    // the dictated answer — that becomes the prefilled poll title.
    @Parameter(
        title: "Poll question",
        description: "What the poll should ask",
        requestValueDialog: "What should the poll ask?"
    )
    var prompt: String

    @MainActor
    func perform() async throws -> some IntentResult & OpensIntent {
        return .result(opensIntent: OpenURLIntent(CreatePollIntent.createURL(prompt: prompt)))
    }

    static func createURL(prompt: String) -> URL {
        // Map the bundle id to the tier host (mirrors capacitor.config.ts).
        let host = Bundle.main.bundleIdentifier == "com.whoeverwants.app.latest"
            ? "latest.whoeverwants.com"
            : "whoeverwants.com"
        var components = URLComponents()
        components.scheme = "https"
        components.host = host
        components.path = "/g/"
        var items = [URLQueryItem(name: "create", value: "1")]
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            items.append(URLQueryItem(name: "title", value: trimmed))
        }
        components.queryItems = items
        // URLComponents always yields a valid URL for these fixed inputs.
        return components.url ?? URL(string: "https://\(host)/g/?create=1")!
    }
}

@available(iOS 18.0, *)
struct WhoeverWantsShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CreatePollIntent(),
            phrases: [
                "Create a poll in \(.applicationName)",
                "Start a poll in \(.applicationName)",
                "Ask a question in \(.applicationName)"
            ],
            shortTitle: "Create a poll",
            systemImageName: "plus.bubble"
        )
    }
}
