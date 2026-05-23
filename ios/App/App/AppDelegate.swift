import UIKit
import Capacitor

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
