import ExpoModulesCore
import UIKit

public class PrivacyCoverModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PrivacyCover")

    OnCreate {
      PrivacyCover.shared.start()
    }

    Function("configure") { (enabled: Bool, lockAfterMs: Double) in
      PrivacyCover.shared.configure(enabled: enabled, lockAfter: lockAfterMs / 1000)
    }

    Function("beginPrompt") {
      PrivacyCover.shared.beginPrompt()
    }

    Function("endPrompt") {
      PrivacyCover.shared.endPrompt()
    }

    Function("reveal") {
      PrivacyCover.shared.reveal()
    }
  }
}

/// A blur over the whole app, put up and taken down on the main thread as the
/// notifications arrive.
///
/// Doing this from JS waits on the bridge and a render, which is long enough
/// for the app switcher to show the Balance and for the blur to linger after
/// the Consumer comes back. It lives in its own window above every sheet and
/// native modal, which a view inside the React root cannot reach.
final class PrivacyCover {
  static let shared = PrivacyCover()

  /// If JS never says the lock screen is up, the Consumer is not left looking
  /// at a blur. JS normally answers within a couple of frames.
  private static let holdTimeout: TimeInterval = 2

  private let state = NSLock()
  private var enabled = false
  private var lockAfter: TimeInterval = .infinity
  private var openPrompts = 0

  // Main thread only.
  private var started = false
  private var window: UIWindow?
  private var backgroundedAt: Date?
  private var holding = false

  func start() {
    DispatchQueue.main.async { [self] in
      guard !started else { return }
      started = true
      let center = NotificationCenter.default
      center.addObserver(
        self, selector: #selector(willResignActive),
        name: UIApplication.willResignActiveNotification, object: nil)
      center.addObserver(
        self, selector: #selector(didEnterBackground),
        name: UIApplication.didEnterBackgroundNotification, object: nil)
      center.addObserver(
        self, selector: #selector(didBecomeActive),
        name: UIApplication.didBecomeActiveNotification, object: nil)
    }
  }

  func configure(enabled: Bool, lockAfter: TimeInterval) {
    state.lock()
    self.enabled = enabled
    self.lockAfter = lockAfter
    state.unlock()
    if !enabled {
      DispatchQueue.main.async { [self] in
        holding = false
        hide()
      }
    }
  }

  /// Called before the app raises a system prompt. Face ID, a passkey sheet
  /// or a permission alert also makes iOS resign the app, and the Consumer
  /// has not left: the screen stays as it was underneath it.
  func beginPrompt() {
    state.lock()
    openPrompts += 1
    state.unlock()
  }

  func endPrompt() {
    state.lock()
    openPrompts = max(0, openPrompts - 1)
    let lastPrompt = openPrompts == 0
    state.unlock()
    guard lastPrompt else { return }
    // A resign that came while the prompt was being answered was skipped, and
    // Notification Center keeps the app inactive without another one. If the
    // app is still not active once the prompt is done, the Consumer has left.
    DispatchQueue.main.async { [self] in
      let now = snapshot()
      guard now.enabled, !now.prompting,
        UIApplication.shared.applicationState != .active
      else { return }
      show()
    }
  }

  /// JS has put the lock screen up, so the blur held over it can go.
  func reveal() {
    DispatchQueue.main.async { [self] in
      guard holding else { return }
      holding = false
      hide()
    }
  }

  private func snapshot() -> (enabled: Bool, lockAfter: TimeInterval, prompting: Bool) {
    state.lock()
    defer { state.unlock() }
    return (enabled, lockAfter, openPrompts > 0)
  }

  @objc private func willResignActive() {
    let now = snapshot()
    guard now.enabled, !now.prompting else { return }
    show()
  }

  @objc private func didEnterBackground() {
    backgroundedAt = Date()
    // Leaving the app while a prompt is up is still leaving it.
    if snapshot().enabled { show() }
  }

  @objc private func didBecomeActive() {
    let now = snapshot()
    let away = backgroundedAt.map { Date().timeIntervalSince($0) } ?? 0
    backgroundedAt = nil
    if now.enabled, window?.isHidden == false, away >= now.lockAfter {
      // The app is about to lock. Keep the blur until the lock screen is
      // drawn, or the Account shows for the frames in between.
      holding = true
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.holdTimeout) { [self] in
        guard holding else { return }
        holding = false
        hide()
      }
      return
    }
    holding = false
    hide()
  }

  private func show() {
    if window == nil {
      guard
        let scene = UIApplication.shared.connectedScenes
          .compactMap({ $0 as? UIWindowScene })
          .first(where: { $0.activationState != .unattached })
      else { return }
      let cover = UIWindow(windowScene: scene)
      cover.windowLevel = .alert + 1
      let controller = UIViewController()
      controller.view.backgroundColor = .clear
      let blur = UIVisualEffectView(effect: UIBlurEffect(style: .light))
      blur.frame = controller.view.bounds
      blur.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      controller.view.addSubview(blur)
      cover.rootViewController = controller
      window = cover
    }
    window?.isHidden = false
  }

  private func hide() {
    window?.isHidden = true
  }
}
