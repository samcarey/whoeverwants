import UIKit
import Capacitor
import UserNotifications
import AppIntents
import Security
import WebKit
import ObjectiveC

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
        // Re-strip the keyboard accessory bar on every keyboard-show, in case
        // the WebKit content view wasn't attached yet at first appearance.
        // Registered here (runs exactly once) rather than in viewDidAppear
        // (fires repeatedly) so no de-dupe flag is needed.
        NotificationCenter.default.addObserver(
            forName: UIResponder.keyboardWillShowNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.webView?.removeInputAccessoryBar()
        }
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

    // Strip iOS's keyboard "input accessory bar" — the prev/next chevrons +
    // Done (✓) row WebKit floats between a focused text field and the keyboard.
    // It reads as "this field is one of many in a form", but the app's inputs
    // are single fields / single-field modals where prev/next navigation is
    // meaningless, so the bar is pure noise (reported on the create-poll search
    // box). The accessory view is owned by WebKit's private content view, not by
    // WKWebView — see `removeInputAccessoryBar()` below. Applied here (well
    // before any input is tapped, so the first focus already has nil); the
    // keyboard-show observer registered in viewDidLoad re-applies it as
    // belt-and-suspenders if the content view wasn't attached yet here.
    //
    // NOTE: WKWebView-only — this is the WebKit *form assistant*, which has no
    // web or native removal API in plain mobile Safari / PWA. This fix changes
    // only the installed Capacitor app; the bar still appears on the web.
    override open func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        webView?.removeInputAccessoryBar()
    }
}

// Helper whose `inputAccessoryView` getter returns nil; its implementation is
// grafted onto a dynamic subclass of WebKit's private content view (see below).
private final class _NoInputAccessoryView: NSObject {
    @objc var inputAccessoryView: UIView? { return nil }
}

extension WKWebView {
    // Remove the keyboard input accessory bar. The bar is provided by
    // `inputAccessoryView` on WebKit's private content view (class name starts
    // with "WKContent", a subview of the scroll view) — NOT on WKWebView itself,
    // so overriding it on WKWebView does nothing. We can't name the private class
    // at compile time, so we dynamically create a one-off subclass of the live
    // instance's class whose `inputAccessoryView` returns nil and reassign the
    // instance to it. Idempotent: once reclassed, the named subclass already
    // exists and re-reassigning to the current class is a no-op.
    func removeInputAccessoryBar() {
        guard let contentView = scrollView.subviews.first(where: {
            String(describing: type(of: $0)).hasPrefix("WKContent")
        }) else { return }

        let baseClass: AnyClass = type(of: contentView)
        let newClassName = "\(baseClass)_NoInputAccessory"

        if let existing = NSClassFromString(newClassName) {
            object_setClass(contentView, existing)
            return
        }

        guard let cName = newClassName.cString(using: .ascii),
              let newClass = objc_allocateClassPair(baseClass, cName, 0) else { return }

        guard let getter = class_getInstanceMethod(
            _NoInputAccessoryView.self,
            #selector(getter: _NoInputAccessoryView.inputAccessoryView)
        ) else {
            objc_disposeClassPair(newClass)
            return
        }

        class_addMethod(
            newClass,
            #selector(getter: UIResponder.inputAccessoryView),
            method_getImplementation(getter),
            method_getTypeEncoding(getter)
        )
        objc_registerClassPair(newClass)
        object_setClass(contentView, newClass)
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

// Build a deep link that opens the WebView create form prefilled: `https://<feHost>
// <path>?create=1[&title=<prompt>][&category=<cat>][&for=<context>]`. `path` is
// "/g/" (empty placeholder → fresh group) or "/g/<groupShort>" (attach to that
// group via <body data-group-id>). Shared by CreatePollIntent (Phase 1) and
// GroupEntity (Phase 4) so the format lives in one place.
//
// Two prefill shapes (consumed by the effect in app/create-poll/page.tsx):
//   • `title=` — a literal user-authored title (yes/no + the network-failure
//     fallback). The web sets isAutoTitle=false so it isn't auto-overwritten.
//   • `category=` + `for=` — a category poll (e.g. PollTextParser detected
//     "movie for friday"): no literal title, so the web auto-titles
//     "<Category> for <context>". Used by the `.category` fallback.
// Trims internally (callers may pass raw or pre-trimmed — both are fine).
private func whoeverwantsCreatePollURL(
    path: String, prompt: String = "", category: String? = nil, context: String? = nil
) -> URL {
    let host = whoeverwantsFEHost()
    var components = URLComponents()
    components.scheme = "https"
    components.host = host
    components.path = path
    var items = [URLQueryItem(name: "create", value: "1")]
    let trimmedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmedPrompt.isEmpty {
        items.append(URLQueryItem(name: "title", value: trimmedPrompt))
    }
    if let category = category, !category.isEmpty {
        items.append(URLQueryItem(name: "category", value: category))
    }
    if let context = context?.trimmingCharacters(in: .whitespacesAndNewlines), !context.isEmpty {
        items.append(URLQueryItem(name: "for", value: context))
    }
    components.queryItems = items
    // URLComponents always yields a valid URL for these fixed inputs.
    return components.url ?? URL(string: "https://\(host)\(path)?create=1")!
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
        // Empty placeholder route → the WebView mints a fresh group on submit.
        whoeverwantsCreatePollURL(path: "/g/", prompt: prompt)
    }

    // Category fallback (PollTextParser `.category`): open the form preselected
    // to a built-in category with the context prefilled, NO literal title — so
    // the web auto-titles "<Category> for <context>".
    static func createCategoryURL(category: String, context: String) -> URL {
        whoeverwantsCreatePollURL(path: "/g/", category: category, context: context)
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

// PollTextParser (the natural-language → poll-shape parser) lives in
// PollTextParser.swift — extracted so the JS↔Swift parity harness
// (scripts/ios/test-parser.sh, run by ios-build.yml) can compile it
// standalone against the shared fixture tests/fixtures/poll-parse-cases.json.

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
    // any failure. `groupUuid` (the `groups.id` UUID, NOT the short_id) attaches
    // the new poll to an existing group via `CreatePollRequest.group_id`; nil →
    // the server mints a fresh group, exactly like an in-app create with no parent.
    static func createPoll(decision: PollTextParser.Parsed, identity: Identity, groupUuid: String? = nil) async throws -> CreatedPoll {
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

        // Build the single question + explicit title from the parsed decision,
        // mirroring what the FE's `draftToQuestionParams` produces:
        //   • .options → a fixed-options ranked_choice (the parsed options are the
        //     ballot; winner_method "consensus" matches the FE default; the "for X"
        //     tail rides as the question `context`). Title is the "A, B, or C?"
        //     or-list the box would show.
        //   • .yesNo  → a yes/no whose prompt is BOTH the wrapper title and the
        //     question `context` (exactly the single-yes_no-draft shape).
        // `.category` never reaches here — quickPollOutcome routes it to the
        // deep-link fallback (those polls need the form to finish).
        var question: [String: Any]
        let title: String
        switch decision.kind {
        case .options:
            question = [
                "question_type": "ranked_choice",
                "options": decision.options,
                "winner_method": "consensus",
            ]
            if !decision.context.isEmpty { question["context"] = decision.context }
            title = PollTextParser.optionsTitle(decision.options, context: decision.context)
        case .yesNo, .category:
            question = ["question_type": "yes_no", "context": decision.prompt]
            title = PollTextParser.yesNoTitle(decision.prompt)
        }

        var body: [String: Any] = [
            "creator_name": identity.name,
            "title": title,
            "questions": [question],
        ]
        // Attach to an existing group when targeting one. The server treats an
        // unknown group_id as "mint a fresh group" (no 404), so a stale uuid
        // degrades gracefully rather than failing the create.
        if let groupUuid = groupUuid, !groupUuid.isEmpty {
            body["group_id"] = groupUuid
        }
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
            let echoed = (obj["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? title
            if let groupShort = obj["group_short_id"] as? String, !groupShort.isEmpty,
               let pollShort = obj["short_id"] as? String, !pollShort.isEmpty {
                return CreatedPoll(title: echoed, path: "/g/\(groupShort)/p/\(pollShort)")
            }
            return CreatedPoll(title: echoed, path: "/")
        }
        return CreatedPoll(title: title, path: "/")
    }
}

// Shared create-or-fall-back flow behind BOTH QuickPollIntent (no group) and
// QuickPollInGroupIntent (group-targeted). Returns the opensIntent + spoken
// dialog; each intent's perform() wraps it in `.result(opensIntent:dialog:)`.
// iOS 18 because it builds OpenURLIntent (createPoll/loadIdentity are iOS 16).
@available(iOS 18.0, *)
extension QuickPollService {
    static func quickPollOutcome(
        prompt: String, group: GroupEntity?
    ) async throws -> (open: OpenURLIntent, dialog: IntentDialog) {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw QuickPollError("I didn't catch a question for the poll.")
        }

        // Parse the phrase LOCALLY (no network) into the right poll shape — the
        // same decision the in-app search box's top suggestion would make. So
        // "pizza, tacos, or sushi" becomes a 3-option pick-one instead of a yes/no.
        let decision = PollTextParser.decide(trimmed)
        let inGroup = group.map { " in \($0.title)" } ?? ""

        // Category polls (restaurant / movie / time / place / …) need the create
        // FORM to finish — time windows, suggestion entry, reference location — so
        // don't headlessly create a wrong/empty poll. Open the form prefilled to
        // the detected category + context (the web auto-titles "<Category> for
        // <context>"). Targets the group's page when one is named so attribution
        // lands via `<body data-group-id>`.
        if decision.kind == .category, let category = decision.category {
            let url = group?.fallbackCreateURL(category: category, context: decision.context)
                ?? CreatePollIntent.createCategoryURL(category: category, context: decision.context)
            return (
                OpenURLIntent(url),
                IntentDialog("Opening WhoeverWants to finish your poll\(inGroup).")
            )
        }

        // options / yes_no → create HEADLESSLY (App Group identity + direct API
        // POST). On ANY failure — identity not readable from this process, network,
        // or server — DON'T dead-end: fall back to the Phase 1 deep link so the
        // user always gets their poll. Swift's opaque `some` return forces both
        // intents' branches to share one underlying type, which is why both paths
        // return an OpenURLIntent-based result.
        if let identity = loadIdentity(),
           let created = try? await createPoll(
               decision: decision, identity: identity, groupUuid: group?.groupUuid
           ) {
            // Open straight to the new poll's detail page (not bare home): the user
            // lands on their freshly-created poll — that IS the confirmation — and
            // it's a real navigation, so it shows even when the WebView was already
            // mounted on `/` (where opening home is a no-op push).
            let what = decision.kind == .options
                ? "a poll with \(decision.options.count) options"
                : "your poll"
            return (
                OpenURLIntent(feURL(path: created.path)),
                IntentDialog("Created \(what)\(inGroup): \(created.title). Opening WhoeverWants.")
            )
        }
        // Headless unavailable — open the create form prefilled with the spoken
        // text. When a group is targeted, route to that group's page so the create
        // form attaches the new poll to it; otherwise the empty placeholder mints
        // a fresh group on submit.
        let fallbackURL = group?.fallbackCreateURL(prompt: trimmed)
            ?? CreatePollIntent.createURL(prompt: trimmed)
        return (
            OpenURLIntent(fallbackURL),
            IntentDialog("Opening WhoeverWants to finish your poll.")
        )
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
        let outcome = try await QuickPollService.quickPollOutcome(prompt: prompt, group: nil)
        return .result(opensIntent: outcome.open, dialog: outcome.dialog)
    }
}

// Phase 4 of docs/siri-integration-plan.md — group-targeted creation.
//
// Same headless-or-fall-back flow as QuickPollIntent, but the poll is attached to
// a specific group the user names by voice ("Add a poll to the trip group …").
// The `group` parameter is resolved via GroupEntityQuery (below); its UUID rides
// the create request's `group_id`, and the deep-link fallback routes to the
// group's page so the WebView create form attaches there too. Kept a SEPARATE
// intent (not an optional param on QuickPollIntent) to (a) keep the
// device-verified no-group path untouched and (b) avoid mixing
// parameter-bound and bare phrases in one AppShortcut. Both share
// `QuickPollService.quickPollOutcome`, so there's no duplicated create logic.
@available(iOS 18.0, *)
struct QuickPollInGroupIntent: AppIntent {
    static var title: LocalizedStringResource = "Quick poll in a group"
    static var description = IntentDescription(
        "Create a poll in one of your groups by voice. WhoeverWants makes it in the background when it can; otherwise it opens prefilled so you can finish in a tap."
    )
    // NOT openAppWhenRun — headless success stays closed; the fallback opens via
    // the OpenURLIntent it returns.

    @Parameter(
        title: "Poll question",
        description: "What the poll should ask",
        requestValueDialog: "What should the poll ask?"
    )
    var prompt: String

    @Parameter(
        title: "Group",
        description: "Which group to add the poll to",
        requestValueDialog: "Which group?"
    )
    var group: GroupEntity

    func perform() async throws -> some IntentResult & ProvidesDialog & OpensIntent {
        let outcome = try await QuickPollService.quickPollOutcome(prompt: prompt, group: group)
        return .result(opensIntent: outcome.open, dialog: outcome.dialog)
    }
}

// Phase 4 FOUNDATION of docs/siri-integration-plan.md — App Entities.
//
// `PollEntity` lets Siri / Shortcuts / Spotlight reference the user's polls BY
// NAME. The thin consumer here is `OpenPollIntent` ("open the dinner poll");
// later Phase 4 intents (vote-by-voice, query-results) reuse the SAME entity +
// query to disambiguate WHICH poll. This is the reusable substrate the plan calls
// the lowest-regret Phase 4 investment — independent of whatever WWDC does to Siri.
//
// The query fetches the user's visible polls from the same `POST /api/groups/mine`
// the WebView home page uses, authenticated with the bridged X-Browser-Id (Phase 2
// App Group). Visibility is therefore BROWSER-SCOPED: the App Group bridges name +
// browser id (NOT the bearer token), so the fetch carries X-Browser-Id only and
// `load_user_visibility` resolves the groups THIS browser is a member of. That
// covers every poll the user created or joined on this device — the common case
// for "reference my poll by name". Cross-device-only polls (joined on another
// device, never opened here) won't surface; that's the same limitation Phase 3's
// headless create has and is acceptable for the foundation.
//
// Colocated in AppDelegate.swift for the same reason everything else here is (no
// pbxproj surgery). `AppEntity` / `EntityQuery` / `EntityStringQuery` are iOS 16+
// (App Intents' floor) with NO iOS-18 dependency, so the entity + query compile
// and resolve on iOS 16–17 too — only `OpenPollIntent` (and thus the spoken
// phrase) needs iOS 18, because it opens via `OpenURLIntent` (iOS 18+) exactly
// like the Phase 1/3 intents. A future headless Phase-4 intent that doesn't open
// the app (e.g. spoken "who's winning …") can be iOS 16 and reuse this entity.

@available(iOS 16.0, *)
struct PollEntity: AppEntity {
    // The poll's short_id — the canonical addressable id (the `<short>` in
    // `/g/<group>/p/<short>`). Stable across refreshes; what every Phase-4 op keys on.
    let id: String
    let title: String
    let groupShortId: String?
    let groupName: String?

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Poll"

    var displayRepresentation: DisplayRepresentation {
        if let group = groupName, !group.isEmpty {
            return DisplayRepresentation(title: "\(title)", subtitle: "\(group)")
        }
        return DisplayRepresentation(title: "\(title)")
    }

    static var defaultQuery = PollEntityQuery()

    // Fetch the user's visible polls from POST /api/groups/mine, authenticated with
    // the bridged browser id (Phase 2 App Group). Returns [] — never throws — when no
    // identity is bridged yet (fresh install) or on any network/parse failure, so a
    // query referencing this entity degrades to "no polls to pick" rather than erroring.
    // Sorted newest-first and capped so voice matching + the Shortcuts picker stay
    // bounded on a busy account.
    static func fetchAll() async -> [PollEntity] {
        guard let identity = QuickPollService.loadIdentity(),
              let browserId = identity.browserId, !browserId.isEmpty,
              let url = URL(string: QuickPollService.apiBase + "/api/groups/mine") else {
            return []
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(browserId, forHTTPHeaderField: "X-Browser-Id")
        if let token = identity.token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["include_results": false])

        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return []
        }
        // Treat empty strings as absent — the API can return "" for an unset
        // override, which should never surface as a title / id / group.
        func nonEmpty(_ s: String?) -> String? { s.flatMap { $0.isEmpty ? nil : $0 } }
        let polls: [(entity: PollEntity, createdAt: String)] = arr.compactMap { obj in
            guard let shortId = nonEmpty(obj["short_id"] as? String) else { return nil }
            // Prefer the poll's OWN subject (questions[0].title) over the display
            // `title`, which collapses to the group-name override when one is set —
            // the same rule the detail-page header uses. Fall back to the display
            // title, then a generic label.
            let questions = obj["questions"] as? [[String: Any]]
            let title = nonEmpty(questions?.first?["title"] as? String)
                ?? nonEmpty(obj["title"] as? String) ?? "Poll"
            let groupShort = nonEmpty(obj["group_short_id"] as? String)
            // group_title is the group-NAME override (NULL when unset) — used only as a
            // disambiguating subtitle, never as the poll's title.
            let groupName = nonEmpty(obj["group_title"] as? String)
            let createdAt = (obj["created_at"] as? String) ?? ""
            let entity = PollEntity(id: shortId, title: title, groupShortId: groupShort, groupName: groupName)
            return (entity: entity, createdAt: createdAt)
        }
        // created_at is ISO-8601, so a lexicographic descending sort is chronological.
        return polls.sorted { $0.createdAt > $1.createdAt }.prefix(50).map { $0.entity }
    }
}

// EntityStringQuery refines EntityQuery, so it provides both the id-resolve
// (`entities(for:)`) and string-match surfaces. iOS calls exactly ONE of these
// methods per resolution (id-resolve from the picker, string-match from speech,
// or suggestedEntities for indexing), so the per-call `fetchAll()` round-trip is
// normal and correct — no shared cache (which would only risk staleness).
@available(iOS 16.0, *)
struct PollEntityQuery: EntityStringQuery {
    // Resolve specific entities by id — Siri/Shortcuts hands back a chosen entity's id.
    func entities(for identifiers: [String]) async throws -> [PollEntity] {
        let wanted = Set(identifiers)
        return await PollEntity.fetchAll().filter { wanted.contains($0.id) }
    }

    // Free-text voice match ("the dinner poll") — case-insensitive substring over the
    // poll title and its group name.
    func entities(matching string: String) async throws -> [PollEntity] {
        let needle = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let all = await PollEntity.fetchAll()
        guard !needle.isEmpty else { return all }
        return all.filter {
            $0.title.lowercased().contains(needle)
                || ($0.groupName?.lowercased().contains(needle) ?? false)
        }
    }

    // Surface the user's polls into Spotlight + the Shortcuts entity picker.
    func suggestedEntities() async throws -> [PollEntity] {
        await PollEntity.fetchAll()
    }
}

// Thin consumer of PollEntity: open one of your polls by name. Proves the entity +
// query end-to-end (resolution, displayRepresentation, Spotlight surfacing) and is
// independently useful. Opens the poll's detail page via the same OpenURLIntent
// loopback the Phase 1/3 intents use (hence iOS 18). NO native poll logic — the
// WebView renders the poll as usual. The entity's id is the poll short_id; combined
// with its groupShortId it yields the canonical `/g/<group>/p/<short>` path.
@available(iOS 18.0, *)
struct OpenPollIntent: AppIntent {
    static var title: LocalizedStringResource = "Open a poll"
    static var description = IntentDescription("Open one of your polls by name.")
    static var openAppWhenRun = true

    @Parameter(title: "Poll")
    var poll: PollEntity

    @MainActor
    func perform() async throws -> some IntentResult & OpensIntent {
        let path: String
        if let group = poll.groupShortId, !group.isEmpty {
            path = "/g/\(group)/p/\(poll.id)"
        } else {
            // No group short id (shouldn't happen for a real poll) — fall back to the
            // legacy /p/<short> redirect stub, which resolves to the canonical URL.
            path = "/p/\(poll.id)"
        }
        return .result(opensIntent: OpenURLIntent(QuickPollService.feURL(path: path)))
    }
}

// Phase 4 of docs/siri-integration-plan.md — group-level App Entity.
//
// GroupEntity is the group-level analog of PollEntity: it lets Siri / Shortcuts /
// Spotlight reference the user's GROUPS by name so a create can target one
// ("Add a poll to the trip group"). `id` is the group SHORT id (the addressable
// `/g/<id>`); `groupUuid` is the `groups.id` UUID that `POST /api/polls`'s
// `group_id` wants — carried separately because the addressable id and the
// create key differ for groups (they coincide for polls). Visibility is
// BROWSER-SCOPED via the bridged X-Browser-Id (Phase 2 App Group) — same
// limitation + rationale as PollEntity. iOS 16 (no OpenURLIntent dependency),
// reusable by a future iOS-16 group-scoped headless intent.
@available(iOS 16.0, *)
struct GroupEntity: AppEntity {
    let id: String          // group short_id — canonical addressable id (/g/<id>)
    let title: String       // group name: override → participant names → "Group"
    let groupUuid: String   // groups.id UUID — what POST /api/polls `group_id` wants
    let pollCount: Int      // 0 for membership-only (empty) groups

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Group"

    var displayRepresentation: DisplayRepresentation {
        let subtitle = pollCount == 0
            ? "No polls yet"
            : (pollCount == 1 ? "1 poll" : "\(pollCount) polls")
        return DisplayRepresentation(title: "\(title)", subtitle: "\(subtitle)")
    }

    static var defaultQuery = GroupEntityQuery()

    // Deep-link fallback target when headless create is unavailable: the group's
    // OWN page, so the WebView create form attaches the new poll here (via
    // `<body data-group-id>`) rather than minting a fresh group. `id` is the
    // short_id; the group page reads `?create=1&title=…` exactly like the Phase 1
    // empty-placeholder deep link, but on a real group route so attribution lands.
    func fallbackCreateURL(prompt: String) -> URL {
        // The group's own route → the WebView attaches the new poll here via
        // `<body data-group-id>` (the group page sets it on mount).
        whoeverwantsCreatePollURL(path: "/g/\(id)", prompt: prompt)
    }

    // Category fallback for a group-targeted phrase (PollTextParser `.category`):
    // preselect the category + context on the group's own page so the web
    // auto-titles "<Category> for <context>" AND attaches via `<body data-group-id>`.
    func fallbackCreateURL(category: String, context: String) -> URL {
        whoeverwantsCreatePollURL(path: "/g/\(id)", category: category, context: context)
    }

    // Fetch the user's visible groups, browser-scoped via the bridged identity.
    // Populated groups come from POST /api/groups/mine (PollResponse[], collapsed
    // by group_id); membership-only empty groups from POST /api/groups/empty
    // (GroupSummary[]). NEVER throws — returns [] on no-identity / network / parse
    // failure, so a consumer degrades to "no groups to pick". Sorted newest-first,
    // capped at 50.
    static func fetchAll() async -> [GroupEntity] {
        guard let identity = QuickPollService.loadIdentity(),
              let browserId = identity.browserId, !browserId.isEmpty else {
            return []
        }
        func nonEmpty(_ s: String?) -> String? { s.flatMap { $0.isEmpty ? nil : $0 } }

        // Shared request for the two POST endpoints; [] on any failure.
        func post(_ path: String, body: [String: Any]?) async -> [[String: Any]] {
            guard let url = URL(string: QuickPollService.apiBase + path) else { return [] }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(browserId, forHTTPHeaderField: "X-Browser-Id")
            if let token = identity.token, !token.isEmpty {
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
            if let body = body {
                request.httpBody = try? JSONSerialization.data(withJSONObject: body)
            }
            guard let (data, response) = try? await URLSession.shared.data(for: request),
                  let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                  let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
                return []
            }
            return arr
        }

        async let mineRaw = post("/api/groups/mine", body: ["include_results": false])
        async let emptyRaw = post("/api/groups/empty", body: nil)

        // Populated groups: collapse the poll list by group_id (uuid), tracking the
        // short_id, title override, a deduped participant-name list, poll count, and
        // the latest created_at.
        struct Agg {
            var shortId: String?
            let uuid: String
            var override: String?
            var names: [String] = []   // insertion-ordered, case-insensitively deduped
            var seen: Set<String> = []
            var count: Int = 0
            var latest: String = ""
        }
        var byUuid: [String: Agg] = [:]
        let selfName = identity.name.trimmingCharacters(in: .whitespaces).lowercased()

        for obj in await mineRaw {
            guard let uuid = nonEmpty(obj["group_id"] as? String) else { continue }
            var agg = byUuid[uuid] ?? Agg(shortId: nil, uuid: uuid, override: nil)
            if agg.shortId == nil { agg.shortId = nonEmpty(obj["group_short_id"] as? String) }
            if agg.override == nil { agg.override = nonEmpty(obj["group_title"] as? String) }
            agg.count += 1
            let createdAt = (obj["created_at"] as? String) ?? ""
            if createdAt > agg.latest { agg.latest = createdAt }
            // Participant names (creator + voters), skipping the current user and
            // de-duplicating case-insensitively — mirrors the FE buildGroups
            // default-title rule so the spoken name matches what the user sees.
            var candidates: [String] = []
            if let c = nonEmpty(obj["creator_name"] as? String) { candidates.append(c) }
            if let voters = obj["voter_names"] as? [String] { candidates.append(contentsOf: voters) }
            for raw in candidates {
                let name = raw.trimmingCharacters(in: .whitespaces)
                let key = name.lowercased()
                guard !name.isEmpty, key != selfName, !agg.seen.contains(key) else { continue }
                agg.seen.insert(key)
                agg.names.append(name)
            }
            byUuid[uuid] = agg
        }

        func displayName(override: String?, names: [String]) -> String {
            if let o = override { return o }
            guard !names.isEmpty else { return "Group" }
            let shown = names.prefix(3).joined(separator: ", ")
            return names.count > 3 ? "\(shown), …" : shown
        }

        var groups: [(entity: GroupEntity, createdAt: String)] = []
        for agg in byUuid.values {
            guard let short = agg.shortId else { continue }  // unaddressable; skip
            let name = displayName(override: agg.override, names: agg.names)
            groups.append((
                entity: GroupEntity(id: short, title: name, groupUuid: agg.uuid, pollCount: agg.count),
                createdAt: agg.latest
            ))
        }

        // Membership-only empty groups (no polls → no participant names; the title
        // override, if any, is the only available name).
        for obj in await emptyRaw {
            guard let uuid = nonEmpty(obj["id"] as? String),
                  let short = nonEmpty(obj["short_id"] as? String) else { continue }
            let name = nonEmpty(obj["title"] as? String) ?? "New group"
            let createdAt = (obj["created_at"] as? String) ?? ""
            groups.append((
                entity: GroupEntity(id: short, title: name, groupUuid: uuid, pollCount: 0),
                createdAt: createdAt
            ))
        }

        // created_at is ISO-8601 → lexicographic descending == chronological.
        return groups.sorted { $0.createdAt > $1.createdAt }.prefix(50).map { $0.entity }
    }
}

// EntityStringQuery refines EntityQuery — provides id-resolve, free-text voice
// match, and Spotlight/Shortcuts-picker suggestions. iOS calls exactly one per
// resolution, so the per-call fetchAll() round-trip is normal (no shared cache,
// which would only risk staleness).
@available(iOS 16.0, *)
struct GroupEntityQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [GroupEntity] {
        let wanted = Set(identifiers)
        return await GroupEntity.fetchAll().filter { wanted.contains($0.id) }
    }

    func entities(matching string: String) async throws -> [GroupEntity] {
        let needle = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let all = await GroupEntity.fetchAll()
        guard !needle.isEmpty else { return all }
        return all.filter { $0.title.lowercased().contains(needle) }
    }

    func suggestedEntities() async throws -> [GroupEntity] {
        await GroupEntity.fetchAll()
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
        // Phase 4: create a poll in a named group. `\(\.$group)` carries the
        // spoken group, resolved via GroupEntityQuery; the bare phrase falls back
        // to App Intents' group picker. Phrasings use "to"/"for" before the group
        // so the app-name "in" suffix doesn't read as a double "in … in …".
        AppShortcut(
            intent: QuickPollInGroupIntent(),
            phrases: [
                "Add a poll to \(\.$group) in \(.applicationName)",
                "Create a poll for \(\.$group) in \(.applicationName)",
                "New poll for \(\.$group) in \(.applicationName)"
            ],
            shortTitle: "Poll a group",
            systemImageName: "person.3.fill"
        )
        // Phase 4 foundation consumer: open a poll by name. `\(\.$poll)` lets the
        // spoken phrase carry the poll, resolved via PollEntityQuery; the bare
        // phrase falls back to App Intents' entity picker.
        AppShortcut(
            intent: OpenPollIntent(),
            phrases: [
                "Open \(\.$poll) in \(.applicationName)",
                "Show \(\.$poll) in \(.applicationName)",
                "Open a poll in \(.applicationName)"
            ],
            shortTitle: "Open a poll",
            systemImageName: "list.bullet.rectangle"
        )
    }
}
