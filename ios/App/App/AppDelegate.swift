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

    // EXPLICITLY register every colocated app-target plugin. This is the
    // load-bearing fix for the "the bridge write never lands" symptom that
    // stalled Phase 3 of docs/siri-integration-plan.md (the headless QuickPoll
    // App Group came up empty because `NativeIdentity.setIdentity` rejected with
    // "plugin is not implemented on ios").
    //
    // Root cause: Capacitor does NOT auto-discover `CAPBridgedPlugin` conformers
    // that are compiled directly into the APP TARGET. Runtime auto-discovery only
    // covers plugins shipped in CocoaPods / Swift Package Manager packages
    // (registered via their package's plugin list). A plugin class colocated in
    // the app binary — as all of ours are, to avoid project.pbxproj surgery in the
    // headless CI build — must be registered by hand here. This is the documented
    // Capacitor pattern (capacitorjs.com/docs/ios/custom-code: override
    // `capacitorDidLoad()` + `bridge?.registerPluginInstance(...)`).
    //
    // Before this, ClipboardUrl / AppBadge / NativeIdentity all silently failed to
    // register — none was ever device-confirmed — and every JS call to them
    // rejected (swallowed by best-effort `catch {}`s on the JS side). MainViewController
    // is the storyboard's root VC (Main.storyboard customClass), so this override runs.
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ClipboardUrlPlugin())
        bridge?.registerPluginInstance(AppBadgePlugin())
        bridge?.registerPluginInstance(NativeIdentityPlugin())
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
// build. App-target plugins are NOT auto-discovered (only CocoaPods/SPM-packaged
// plugins are), so this class is registered by hand in
// MainViewController.capacitorDidLoad().
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
// in the headless CI build. App-target plugins are NOT auto-discovered (only
// CocoaPods/SPM-packaged plugins are), so this class is registered by hand in
// MainViewController.capacitorDidLoad().
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

    // Dedicated keychain access group shared between the foreground app process
    // (the NativeIdentity plugin WRITES the identity) and the headless
    // QuickPollIntent (which READS it). MUST match the `.siri`-suffixed entry in
    // the keychain-access-groups entitlement (App.entitlements).
    //
    // Why this exists: iOS can run a no-`openAppWhenRun` App Intent in a process
    // separate from the app. Without an explicit shared group, a Keychain write
    // lands in the WRITER's default access group and the intent's read (in its
    // own default group) returns errSecItemNotFound — so loadIdentity() was nil
    // and the intent spoke "set your name first" even with the name set. The
    // Phase 2/3 "in-process, no entitlement needed" assumption was wrong;
    // foregrounding the app (which DID write the keychain) never fixed it
    // because the intent still read a different partition. Targeting one named
    // group both contexts list makes them agree regardless of process.
    //
    // The prefix is the team / app-id prefix (mirrors the AASA appIDs
    // `479DZ4AZT5.<bundle>`); the entitlement uses the $(AppIdentifierPrefix)
    // macro, which can't be read at runtime, so it's hardcoded here. If it's
    // ever wrong the queries fail closed (no other code reads this keychain),
    // degrading to the pre-fix behavior rather than breaking anything else.
    static let accessGroup: String? = {
        guard let bundle = Bundle.main.bundleIdentifier else { return nil }
        return "479DZ4AZT5.\(bundle).siri"
    }()

    private static func baseQuery(_ account: String) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let group = accessGroup { query[kSecAttrAccessGroup as String] = group }
        return query
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

// Shared App Group store — the channel iOS ACTUALLY shares with the headless
// QuickPollIntent's separate process (the Keychain isn't, proven on device:
// "shared no, default no"). The NativeIdentity plugin mirrors the display name
// + browser id here on every session change; QuickPollService.loadIdentity reads
// them here. Deliberately NOT the bearer token (App Group UserDefaults is less
// hardened than the Keychain, and name + browser id are enough for an attributed
// create — X-Browser-Id resolves to the account). MUST match the
// com.apple.security.application-groups entitlement.
private enum NativeIdentityAppGroup {
    static let suiteName = "group.com.whoeverwants.siri"
    static let nameKey = "display_name"
    static let browserIdKey = "browser_id"

    private static var defaults: UserDefaults? { UserDefaults(suiteName: suiteName) }

    // Upsert non-empty values; nil / "" clears (mirrors the Keychain set semantics
    // so sign-out — null name — removes the headless identity too).
    static func set(name: String?, browserId: String?) {
        guard let d = defaults else { return }
        if let n = name, !n.isEmpty { d.set(n, forKey: nameKey) } else { d.removeObject(forKey: nameKey) }
        if let b = browserId, !b.isEmpty { d.set(b, forKey: browserIdKey) } else { d.removeObject(forKey: browserIdKey) }
    }

    static func name() -> String? { defaults?.string(forKey: nameKey) }
    static func browserId() -> String? { defaults?.string(forKey: browserIdKey) }
}

// Custom Capacitor plugin: write/read the WebView's identity to/from the
// Keychain (see NativeIdentityKeychain above) AND mirror name + browser id into
// the shared App Group (NativeIdentityAppGroup) for the headless intent.
// `setIdentity` is driven by `lib/nativeIdentity.ts` on every session change
// (sign-out passes a null token + null name, so it doubles as the clear path);
// `getIdentity` lets native code (and an on-device round-trip check) read it back.
//
// Colocated in AppDelegate.swift for the same reason MainViewController /
// ClipboardUrlPlugin / AppBadgePlugin are: a new .swift file means hand-patching
// project.pbxproj in the headless CI build. App-target plugins are NOT
// auto-discovered (only CocoaPods/SPM-packaged plugins are), so this class is
// registered by hand in MainViewController.capacitorDidLoad() — that explicit
// registration is what makes `setIdentity` actually reachable from JS (without
// it the App Group write never landed and Phase 3 headless creation stalled).
// Keychain APIs need no `@available` gate (available on every supported iOS),
// unlike the iOS-18 OpenURLIntent below.
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
        let token = call.getString("token")
        let browserId = call.getString("browserId")
        let name = call.getString("name")
        NativeIdentityKeychain.set(NativeIdentityKeychain.tokenAccount, token)
        NativeIdentityKeychain.set(NativeIdentityKeychain.browserIdAccount, browserId)
        NativeIdentityKeychain.set(NativeIdentityKeychain.nameAccount, name)
        // Mirror name + browser id into the shared App Group so the headless
        // QuickPollIntent (separate process, can't read the Keychain) can read them.
        NativeIdentityAppGroup.set(name: name, browserId: browserId)
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
// Single source of truth for the per-tier bundle discriminator. The canary
// build (`com.whoeverwants.app.latest`) loads/targets the `latest.` hosts; the
// prod build (`com.whoeverwants.app`) the bare hosts. Mirrors CAP_ENV /
// capacitor.config.ts. Used by both the Phase 1 deep-link host (FE) and the
// Phase 3 headless API host.
private func whoeverwantsIsCanaryBundle() -> Bool {
    Bundle.main.bundleIdentifier == "com.whoeverwants.app.latest"
}

// The FE host the WebView loads for this bundle (canary → latest.whoeverwants.com,
// prod → whoeverwants.com), mirroring capacitor.config.ts. Single source of truth
// for the per-tier FE host used by the Phase 1 deep-link URL AND the Phase 3
// success-open URL. (The API host — api.latest… / api… — is a separate mapping in
// QuickPollService.apiBase.)
private func whoeverwantsFEHost() -> String {
    whoeverwantsIsCanaryBundle() ? "latest.whoeverwants.com" : "whoeverwants.com"
}

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
        let host = whoeverwantsFEHost()
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

// Phase 3 of docs/siri-integration-plan.md — HEADLESS poll creation.
//
// Unlike the Phase 1 deep-link intent (which foregrounds the app so the user
// reviews + submits in the WebView), this intent creates the poll itself via a
// native API call and the app NEVER opens. It reads the user's identity from the
// Phase 2 Keychain bridge (`NativeIdentityKeychain`) and POSTs the same
// cross-origin JSON request the WebView makes since the May 2026 CORS change —
// byte-for-byte the same `POST /api/polls` with `Authorization: Bearer <token>`
// + `X-Browser-Id`. Siri speaks a confirmation; the poll appears in the WebView
// on the next foreground.
//
// Deliberately NO "open it?" affordance: the plan listed it as a "+", but the
// hard acceptance criterion is "app un-launched", and the only way an App Intent
// can open the app (`OpensIntent`) ALWAYS foregrounds it — which would defeat the
// whole point. So this stays a pure ProvidesDialog result. If a tappable
// (non-forced) open is wanted later, that's a snippet view, not OpensIntent.
//
// Gated at iOS 16 (App Intents' floor; no iOS-18 `OpenURLIntent` dependency here
// since nothing opens). The iOS-18 AppShortcutsProvider below references it fine
// (referencing a more-available type from a less-available context is allowed),
// so the SPOKEN phrase surfaces on iOS 18+ while the intent itself is also
// usable in the manual Shortcuts app on iOS 16–17.
//
// Colocated in AppDelegate.swift for the same reason everything else here is: a
// new .swift file means hand-patching project.pbxproj in the headless CI build.
// An App Intent is auto-discovered at build/run time — no pbxproj change.
//
// CORRECTION (the original "in-process, plain Keychain, no entitlement" claim
// was WRONG): iOS runs this no-`openAppWhenRun` intent in a process separate
// from the app, so it CANNOT read the app's default-group Keychain. The fix is
// the `keychain-access-groups` entitlement + the dedicated `.siri` access group
// both contexts target (see NativeIdentityKeychain above). That entitlement
// needs the "Keychain Sharing" capability on each App ID; automatic signing
// (`-allowProvisioningUpdates` + the Admin API key) auto-provisions it the same
// way it does aps-environment / applesignin / associated-domains.

// A graceful, Siri-speakable failure. Conforming to
// CustomLocalizedStringResourceConvertible makes Siri read `message` aloud
// instead of a generic "something went wrong", so signed-out / network / server
// failures all surface a useful spoken sentence.
@available(iOS 16.0, *)
struct QuickPollError: Error, CustomLocalizedStringResourceConvertible {
    let message: LocalizedStringResource
    init(_ message: LocalizedStringResource) { self.message = message }
    var localizedStringResource: LocalizedStringResource { message }
}

@available(iOS 16.0, *)
enum QuickPollService {
    struct Identity {
        let token: String?      // bearer; optional (anonymous-but-named still works)
        let browserId: String?  // X-Browser-Id; attributes to the auto-account
        let name: String        // creator_name; the server REQUIRES this (non-blank)
    }

    // The created poll's title (the server may have normalized it) + the FE path
    // to open so the success path lands directly on the new poll
    // ("/g/<groupShort>/p/<pollShort>", or "/" when the response lacked short ids).
    struct CreatedPoll {
        let title: String
        let path: String
    }

    // The display name is the ONLY hard server requirement: `POST /api/polls`
    // runs `validate_user_name(creator_name)` and 400s on blank. The bearer token
    // is optional — an anonymous-but-named user has a browser-keyed auto-minted
    // account, exactly as when they create a poll in the app without signing in.
    // So we gate on the NAME (mirroring the app: name-required, sign-in optional).
    //
    // Reads from the shared App GROUP, NOT the Keychain: on-device diagnostics
    // proved this intent's process can't read the app's Keychain in any access
    // group. The App Group is the channel iOS shares with the intent's process.
    // The token isn't mirrored there (browser id → account attribution suffices),
    // so headless creates resolve to the user's account via X-Browser-Id. A fresh
    // install with nothing bridged yet → nil → the intent falls back to opening
    // the prefilled form.
    static func loadIdentity() -> Identity? {
        guard let name = NativeIdentityAppGroup.name(), !name.isEmpty else { return nil }
        let browserId = NativeIdentityAppGroup.browserId()
        return Identity(token: nil, browserId: browserId, name: name)
    }

    // Direct cross-origin API host (NOT the FE host the WebView loads), mirroring
    // lib/api/_internal.ts: prod bundle → api.whoeverwants.com, canary bundle →
    // api.latest.whoeverwants.com. FastAPI CORS is allow_origins=["*"],
    // allow_credentials=False, so a native request (no Origin, X-Browser-Id as the
    // identity header) is exactly the shape the browser sends.
    static var apiBase: String {
        whoeverwantsIsCanaryBundle()
            ? "https://api.latest.whoeverwants.com"
            : "https://api.whoeverwants.com"
    }

    // Build an FE URL for a relative path on the WebView's origin (mirrors
    // capacitor.config.ts host mapping). Used to open straight to the created
    // poll's detail page on success, so the user lands ON the new poll (visual
    // confirmation + immediate visibility) rather than bare home — which, when
    // the WebView is already mounted on `/`, is a no-op router.push that never
    // re-fetches, so the poll wouldn't appear until a remount.
    static func feURL(path: String) -> URL {
        URL(string: "https://\(whoeverwantsFEHost())\(path)") ?? feHomeURL()
    }

    // FE home — the safe, non-recursive fallback when no poll path is available
    // (feURL falls back here on a malformed path, so this must NOT route through feURL).
    static func feHomeURL() -> URL {
        URL(string: "https://\(whoeverwantsFEHost())/") ?? URL(string: "https://whoeverwants.com/")!
    }

    // Returns the created poll's title (echoed back by the server, which may have
    // normalized it) + the FE path to open. Throws a QuickPollError (spoken) on
    // any failure.
    static func createPoll(prompt: String, identity: Identity) async throws -> CreatedPoll {
        guard let url = URL(string: apiBase + "/api/polls") else {
            throw QuickPollError("I couldn't reach WhoeverWants. Try again in a moment.")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = identity.token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let browserId = identity.browserId, !browserId.isEmpty {
            request.setValue(browserId, forHTTPHeaderField: "X-Browser-Id")
        }

        // Minimal single-question yes/no poll. The spoken prompt is BOTH the
        // wrapper title and the question's `context` — mirroring exactly what the
        // FE's `draftToQuestionParams` produces for a single yes_no draft (the
        // typed prompt becomes the wrapper title, and rides as `context` too). No
        // deadlines, no suggestion phase, no category: the deliberately minimal
        // native slice the plan calls for (don't reimplement the whole request).
        let body: [String: Any] = [
            "creator_name": identity.name,
            "title": prompt,
            "questions": [["question_type": "yes_no", "context": prompt]],
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw QuickPollError("I couldn't reach WhoeverWants. Try again in a moment.")
        }
        guard (200..<300).contains(http.statusCode) else {
            // A stale bearer normally degrades to an anonymous (browser-keyed)
            // create rather than 401 — but handle 401 defensively. Everything else
            // (incl. a 400 from a name the server rejects) → open-the-app advice.
            if http.statusCode == 401 {
                throw QuickPollError("Your sign-in expired. Open WhoeverWants to sign in again.")
            }
            throw QuickPollError("WhoeverWants couldn't create the poll. Open the app and try there.")
        }
        // Parse the title (server may normalize it) + the poll's path so the
        // success open lands directly on the new poll. `group_short_id` + `short_id`
        // are both NOT NULL on a fresh PollResponse (migrations 100/101); fall back
        // to home if either is somehow absent.
        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            let title = (obj["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? prompt
            if let groupShort = obj["group_short_id"] as? String, !groupShort.isEmpty,
               let pollShort = obj["short_id"] as? String, !pollShort.isEmpty {
                return CreatedPoll(title: title, path: "/g/\(groupShort)/p/\(pollShort)")
            }
            return CreatedPoll(title: title, path: "/")
        }
        return CreatedPoll(title: prompt, path: "/")
    }
}

// iOS 18+ (was 16): the never-dead-end fallback returns an OpenURLIntent, which
// is iOS 18-only. The spoken phrase already requires iOS 18 (AppShortcuts), so
// the only thing lost is manual Shortcuts-app use on iOS 16–17 — acceptable.
@available(iOS 18.0, *)
struct QuickPollIntent: AppIntent {
    static var title: LocalizedStringResource = "Quick poll"
    static var description = IntentDescription(
        "Create a poll by voice. WhoeverWants makes it in the background when it can; otherwise it opens prefilled so you can finish in a tap."
    )
    // NOT openAppWhenRun — the headless-success path stays closed. The fallback
    // opens the app via the OpenURLIntent it returns, not via openAppWhenRun.

    @Parameter(
        title: "Poll question",
        description: "What the poll should ask",
        requestValueDialog: "What should the poll ask?"
    )
    var prompt: String

    func perform() async throws -> some IntentResult & ProvidesDialog & OpensIntent {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw QuickPollError("I didn't catch a question for the poll.")
        }
        // Try headless creation. On ANY failure — the identity bridge isn't
        // reliably readable from this intent's (separate) process, or network /
        // server trouble — DON'T dead-end: fall back to the Phase 1 deep link,
        // opening the app to the create form with the prompt prefilled, so the
        // user always gets their poll. Swift's opaque return type requires every
        // return to share one underlying type, so BOTH branches return an
        // OpenURLIntent-based result (you cannot mix `.result(dialog:)` with
        // `.result(opensIntent:dialog:)` under one `some` return).
        if let identity = QuickPollService.loadIdentity(),
           let created = try? await QuickPollService.createPoll(prompt: trimmed, identity: identity) {
            // Open straight to the new poll's detail page (not bare home): the user
            // lands on their freshly-created poll — that IS the confirmation — and
            // it's a real navigation, so it shows immediately even when the WebView
            // was already mounted on `/` (where opening home is a no-op push).
            return .result(
                opensIntent: OpenURLIntent(QuickPollService.feURL(path: created.path)),
                dialog: IntentDialog("Created your poll: \(created.title). Opening WhoeverWants.")
            )
        }
        // Headless identity unavailable on this device (see the App Group note on
        // loadIdentity — the bridge write isn't landing yet). Fall back to the
        // Phase 1 deep link, opening the app to the create form with the prompt
        // prefilled, so the user always gets their poll.
        return .result(
            opensIntent: OpenURLIntent(CreatePollIntent.createURL(prompt: trimmed)),
            dialog: IntentDialog("Opening WhoeverWants to finish your poll.")
        )
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
        AppShortcut(
            intent: QuickPollIntent(),
            phrases: [
                "Quick poll in \(.applicationName)",
                "Quickly create a poll in \(.applicationName)",
                "Post a poll in \(.applicationName)"
            ],
            shortTitle: "Quick poll",
            systemImageName: "bolt.fill"
        )
    }
}
