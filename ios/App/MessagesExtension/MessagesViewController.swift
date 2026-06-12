import Messages
import SwiftUI
import UIKit

// Phase 0 scaffold for the WhoeverWants iMessage extension.
//
// This is intentionally a static placeholder: it proves the extension target
// builds, signs, embeds in the host IPA, and appears in the Messages drawer.
// No identity bridge, no networking, no MSMessageLiveLayout yet — those land in
// later phases (see docs/imessage-extension-plan.md). The extension is a
// SEPARATE process from the host app and cannot see the WebView's localStorage,
// so future phases read the App-Group-bridged identity (NativeIdentityAppGroup
// in AppDelegate.swift), gated on the App Groups capability being registered on
// the per-tier extension bundle ids — a Phase 1 prerequisite, deliberately not
// required here so automatic signing can self-provision this scaffold.
class MessagesViewController: MSMessagesAppViewController {

    private var hosting: UIHostingController<PlaceholderView>?

    override func viewDidLoad() {
        super.viewDidLoad()
        let controller = UIHostingController(rootView: PlaceholderView())
        controller.view.backgroundColor = .clear
        addChild(controller)
        controller.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(controller.view)
        NSLayoutConstraint.activate([
            controller.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            controller.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            controller.view.topAnchor.constraint(equalTo: view.topAnchor),
            controller.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        controller.didMove(toParent: self)
        hosting = controller
    }
}

private struct PlaceholderView: View {
    var body: some View {
        VStack(spacing: 8) {
            Text("👋")
                .font(.system(size: 44))
            Text("WhoeverWants")
                .font(.headline)
            Text("Shareable polls are coming to Messages.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
