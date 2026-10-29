# Updates: one-time setup and releasing

Moto Lines Studio checks GitHub Releases each time it starts. When there's a newer version it asks before downloading, verifies the download's signature, and starts it after a restart.

## One-time setup (about 10 minutes)

1. **GitHub account and repository.** Sign up at github.com (free). Create a **public** repository, for example `moto-lines-studio`. It must be public so the people you share the app with can download updates without logging in.
2. **Signing key secret.** In the repository open *Settings → Secrets and variables → Actions → New repository secret*. Name it `UPDATE_SIGNING_KEY` and paste the whole contents of `moto-lines-studio-update-signing-key.pem`, including the `BEGIN` and `END` lines.
   - Keep a backup of that file somewhere safe and offline (a USB stick or password manager). Don't share it or commit it.
   - If it leaks, someone could sign fake updates. If it's lost, you'd need a new key, and everyone would have to download one new build by hand.
3. **Put the code in the repository.** Easiest: connect GitHub to Claude (claude.ai → Settings → Connectors → GitHub) and tell Claude the repository name, e.g. `yourname/moto-lines-studio`. Claude pushes the code and publishes the first release. Or upload the contents of the source zip yourself and push a tag `v1.3.0`.
4. **First install.** When the *Release* action finishes, the release page has `Moto-Lines-Studio-v1.3.0-Windows.zip`. You and anyone you share it with download that once. From then on, updates come through the app.

The repository name is built into each release, so builds made outside your repository don't check for updates. That's why the first install must come from the release.

## Releasing an update

1. Change the code, raise `version` in `package.json` (e.g. 1.3.0 → 1.3.1) and add a `## 1.3.1` section at the top of `CHANGELOG.md`. That section becomes the "What's new" text.
2. Commit, then tag and push: `git tag v1.3.1 && git push && git push --tags`.
3. The *Release* action tests, builds, signs and publishes it. The next time anyone opens the app, they see "Moto Lines Studio 1.3.1 is available".

Or ask Claude to "release it"; it can do all three steps once GitHub is connected.

## What happens on each computer

- On launch the app asks GitHub for the latest release (a few kilobytes). The update file (about 8 MB) downloads only when someone clicks **Download**.
- **Skip this version** hides that version until a newer one appears. Help → *Check for updates…* still finds it. The launch check can be turned off in Help → About.
- Updates are stored in `user-data/updates` next to the app. The app folder itself is never changed.
- If an update has been modified, or fails to start twice, the app runs the previous working version.
- Occasionally an update needs a newer app runtime (Electron). Then the bar offers **Open download page** for a one-off full download instead.
