# Herdr App Notifier

A community mod that sends native macOS Notification Center alerts when a background Herdr App agent finishes a turn or needs your input. Notifications use a small local helper app with the **Herdr icon**. The project does not use `terminal-notifier`, AppleScript, Homebrew, or third-party notification utilities.

## Requirements

- macOS with Herdr App 0.1.11 or newer
- Apple's Swift compiler and macOS SDK (`xcode-select --install` if needed)
- Herdr App installed at `/Applications/Herdr.app`, or set `HERDR_APP_BUNDLE` to its app-bundle path

## Install

```bash
git clone https://github.com/AlekseyBeketov/herdr-app-notifier.git
cd herdr-app-notifier
./scripts/install.sh
```

The installer builds a universal arm64/x86_64 helper locally, copies the Herdr app icon into it, ad-hoc signs it, and installs the mod at `~/.config/herdr-app/mods/herdr-app-notifier`. It runs `herdr-app check` and refuses to overwrite an existing mod. Set `HERDR_APP_HOME` for a non-default Herdr data directory and `HERDR_APP_BUNDLE` for a non-default app location.

Herdr docks new mods according to `mod/mod.json`. If the panel is not visible in an already-running app, run:

```bash
herdr-app do mod.open --name herdr-app-notifier
```

In the panel, select **Enable and test**. On first use, allow **Herdr App Notifier** to send notifications. Choose Banners or Alerts in **System Settings → Notifications → Herdr App Notifier**. If macOS previously denied permission, enable it there manually.

The native helper uses the bundle ID `dev.alekseybeketov.herdr-app-notifier.native` to avoid stale macOS sender-icon records. macOS may therefore treat an upgrade from the previous helper identity as a new sender and ask for notification permission again; allow the new **Herdr App Notifier** entry. The old entry may remain in Notification Settings.

After setup, click **Hide panel (keep notifications)**. This hides the UI while the hidden layout block continues monitoring agents. Do not remove that block or close the mod; without a running copy, notifications stop. To show it again, use Herdr's layout controls to show the hidden block.

## What it notifies about

- A background agent changes to **done**.
- A background agent changes to **blocked** and needs input.
- Agents already in those states when the mod loads are seeded silently; installation does not replay old alerts.
- The currently focused agent is suppressed.

Alerts include the agent app and Herdr space name, not terminal output, prompts, source files, or conversation history. The mod does not poll, make network requests, or collect telemetry. Alerts are silent by default because Herdr App already plays its own sounds.

The helper uses Apple's legacy `NSUserNotificationCenter` API. Apple deprecated it in macOS 11. On the tested macOS 27 machine, the newer `UserNotifications` API rejected an ad-hoc-signed helper during client validation; using that route would require a properly signed helper and a signing identity. The legacy API is used here so contributors can build locally without a signing certificate. A future macOS release may remove it; a durable first-party solution would be for Herdr App to expose native notifications itself.

## Tests and development

```bash
npm test
./scripts/build-native.sh /tmp/HerdrNotifier.app /Applications/Herdr.app/Contents/Resources/Herdr.icns
herdr-app check ./mod
```

Tests use Node's built-in test runner. Build and notification permission/presentation must also be tested interactively on macOS.

## Uninstall

Remove the `herdr-app-notifier` folder from `~/.config/herdr-app/mods/` (or your `HERDR_APP_HOME`). In **System Settings → Notifications**, disable permission for **Herdr App Notifier** if desired.

## Share this mod

Herdr App mods are folders, not `herdr` CLI plugins. To list this mod on [herdr.dev/mods](https://herdr.dev/mods), publish the repository publicly with the GitHub topic `herdr-mod`, and keep `RECIPE.md` and `preview.png` at the repository root.
