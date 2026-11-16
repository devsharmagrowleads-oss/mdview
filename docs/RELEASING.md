# Releasing MDView

## One-time setup

### 1. Update signing key (required)

Installed copies of MDView only accept updates signed with the project's key. The public key
is in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). The private key is **not** in the
repository; keep it safe, because losing it means existing installs can never auto-update again.

Add it to the repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | The contents of the private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Its password (empty if it has none) |

Local release builds need the same two values as environment variables.

### 2. Code signing (recommended, paid)

Without it, Windows SmartScreen and macOS Gatekeeper warn on first run.

- **Windows:** Azure Trusted Signing (about $10/month) or an OV/EV certificate. Set
  `bundle.windows.signCommand` in `tauri.conf.json`, or use the certificate options of
  `tauri-action`. Open-source projects can apply to SignPath Foundation for free signing.
- **macOS:** an Apple Developer account ($99/year). Add `APPLE_CERTIFICATE`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` and
  `APPLE_TEAM_ID` as secrets and pass them to `tauri-action` as environment variables; it then
  signs and notarizes.

## Each release

1. Bump the version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` and
   `integrations/claude-code/.claude-plugin/plugin.json`.
2. Commit, then tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. The **Build installers** workflow creates a draft release with the installers and
   `latest.json`. Check it, then publish it. Installed copies see the update once it is published.
4. Package managers:

   ```sh
   node packaging/make-manifests.mjs 0.2.0
   ```

   - **winget:** copy `packaging/winget/DevSharma.MDView/<version>/` to
     `manifests/d/DevSharma/MDView/<version>/` in a fork of `microsoft/winget-pkgs` and open a PR
     (or use `wingetcreate submit`). After approval: `winget install DevSharma.MDView`.
   - **Scoop:** commit `packaging/scoop/mdview.json` to a bucket repository (for example
     `scoop-mdview`). Users: `scoop bucket add mdview https://github.com/<you>/scoop-mdview`
     then `scoop install mdview`.
   - **Homebrew:** commit `packaging/homebrew/mdview.rb` as `Casks/mdview.rb` in a repository
     named `homebrew-mdview`. Users: `brew install --cask <you>/mdview/mdview`.
