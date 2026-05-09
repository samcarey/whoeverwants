import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Default UIWindow background is black; if the WebView's frame ever
        // shrinks below screen bounds (safe-area layout-guide, transient
        // resize during rotation, etc.) the window's bg shows through as
        // a black bar. Pin to white so any leak matches the page's light
        // background.
        window?.backgroundColor = .white
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

}

// CAPBridgeViewController.loadView() is `final` and assigns
// `view = webView`, so we can't override the view hierarchy. The
// home-indicator zone on iPhone X-class devices was rendering as a
// black bar on top of the WebView — symptomatic of either the WebView's
// frame not reaching the screen bottom or a backing surface showing
// through under the home-indicator area. Pin every backing surface this
// view controller touches to white so a leak in any layer reads as
// page-background instead of a black bar. Lives in AppDelegate.swift
// (rather than a new file) because that file is already wired into the
// Xcode build phase — adding a new .swift file requires hand-patching
// project.pbxproj which is fragile.
class MainViewController: CAPBridgeViewController {
    override open func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        webView?.backgroundColor = .white
        webView?.scrollView.backgroundColor = .white
        webView?.isOpaque = true
    }
}
