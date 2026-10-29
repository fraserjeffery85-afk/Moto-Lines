# Updates: one-time setup and releasing

Moto Lines Studio checks GitHub Releases each time it starts. When there's a newer version it asks before downloading, verifies the download's signature, and starts it after a restart.

## One-time setup (about 10 minutes)

1. **GitHub account and repository.** Sign up at github.com (free). Create a **public** repository, for example `moto-lines-studio`. It must be public so the people you share the app with can download updates without logging in.
2. **Signing key secret.** In the repository open *Settings → Secrets and variables → Actions → New repository secret*. Name it `UPDATE_SIGNING_KEY` and paste the whole contents of `moto-lines-studio-update-signing-key.pem`, including the `BEGIN` and `END` lines.
   - Keep a backup of that file somewhere safe and offline (a USB stick or password manager). Don't share it or commit it.
   - If it leaks, someone could sign fake updates. If it's lost, you'd need a new key, and everyone would have to download one new build by hand.
3. **Put the code in the repository.** Easiest: connect GitHub to Claude (claude.ai → Settings → Connectors → GitHub) and tell Claude the repository name, e.g. `yourname/moto-lines-studio`. Claude pushes the code and publishes the first release. Or upload the contents of the source zip yourself; pushing to `main` publishes the release.
4. **First install.** When the *Release* action finishes, the release page has `Moto-Lines-Studio-Setup-<version>.exe`. You and anyone you share it with run it once. It installs the app with a desktop shortcut. From then on, updates come through the app.

The repository name is built into each release, so builds made outside your repository don't check for updates. That's why the first install must come from the release.

## Releasing an update

1. Change the code, raise `version` in `package.json` (e.g. 1.3.0 → 1.3.1) and add a `## 1.3.1` section at the top of `CHANGELOG.md`. That section becomes the "What's new" text.
2. Push to `main`. The *Release* action sees a version that hasn't been released, then tests, builds, signs and publishes it. GitHub creates the `v1.3.1` tag itself. Pushes that don't change the version publish nothing.
3. The next time anyone opens the app, they see "Moto Lines Studio 1.3.1 is available".

You can also start the action by hand: *Actions → Release → Run workflow*. Or ask Claude to "release it".

## What happens on each computer

- On launch the app asks GitHub for the latest release (a few kilobytes). The update file (about 8 MB) downloads only when someone clicks **Download**.
- **Skip this version** hides that version until a newer one appears. Help → *Check for updates…* still finds it. The launch check can be turned off in Help → About.
- Updates are stored in `%APPDATA%\Moto Lines Studio\updates` (or `user-data\updates` beside a portable copy). The installed program files are never changed.
- If an update has been modified, or fails to start twice, the app runs the previous working version.
- Occasionally an update needs a newer app runtime (Electron). Then the bar offers **Open download page**, where the new Setup.exe installs over the old version and keeps all settings.
