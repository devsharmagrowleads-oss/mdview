#!/usr/bin/env node
// Write winget, Scoop and Homebrew manifests for a published GitHub release.
//
//   node packaging/make-manifests.mjs 0.2.0
//
// Downloads the release's Windows installer and macOS disk image, hashes them,
// and writes:
//   packaging/winget/DevSharma.MDView/<version>/*.yaml   -> PR to microsoft/winget-pkgs
//   packaging/scoop/mdview.json                         -> your Scoop bucket repo
//   packaging/homebrew/mdview.rb                        -> Casks/ in your homebrew tap repo
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "devsharmagrowleads-oss/mdview";
const HOME = `https://github.com/${REPO}`;
const here = dirname(fileURLToPath(import.meta.url));

const version = (process.argv[2] ?? "").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: node packaging/make-manifests.mjs <version>   (for example 0.2.0)");
  process.exit(1);
}

const exeName = `MDView_${version}_x64-setup.exe`;
const dmgName = `MDView_${version}_universal.dmg`;
const download = (name) => `${HOME}/releases/download/v${version}/${name}`;

async function sha256(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status} (is the v${version} release published?)`);
  return createHash("sha256").update(Buffer.from(await res.arrayBuffer())).digest("hex").toUpperCase();
}

function write(rel, text) {
  const path = join(here, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text.replace(/^\n/, ""));
  console.log("wrote", path);
}

const exeHash = await sha256(download(exeName));
const dmgHash = await sha256(download(dmgName)).catch((err) => {
  console.warn(`No macOS image, skipping Homebrew: ${err.message}`);
  return null;
});

const id = "DevSharma.MDView";
const schema = "https://aka.ms/winget-manifest";
write(
  `winget/${id}/${version}/${id}.yaml`,
  `
# yaml-language-server: $schema=${schema}.version.1.9.0.schema.json
PackageIdentifier: ${id}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.9.0
`,
);
write(
  `winget/${id}/${version}/${id}.installer.yaml`,
  `
# yaml-language-server: $schema=${schema}.installer.1.9.0.schema.json
PackageIdentifier: ${id}
PackageVersion: ${version}
InstallerType: nullsoft
Scope: user
InstallModes:
  - interactive
  - silent
UpgradeBehavior: install
Commands:
  - mdview
Protocols:
  - mdview
FileExtensions:
  - md
  - markdown
  - mdown
  - mkd
Installers:
  - Architecture: x64
    InstallerUrl: ${download(exeName)}
    InstallerSha256: ${exeHash}
ManifestType: installer
ManifestVersion: 1.9.0
`,
);
write(
  `winget/${id}/${version}/${id}.locale.en-US.yaml`,
  `
# yaml-language-server: $schema=${schema}.defaultLocale.1.9.0.schema.json
PackageIdentifier: ${id}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: Dev Sharma
PublisherUrl: https://github.com/devsharmagrowleads-oss
PackageName: MDView
PackageUrl: ${HOME}
License: MIT
LicenseUrl: ${HOME}/blob/main/LICENSE
ShortDescription: A light, offline Markdown viewer and editor that opens the files your AI agents write.
Moniker: mdview
Tags:
  - markdown
  - viewer
  - editor
  - ai
ReleaseNotesUrl: ${HOME}/releases/tag/v${version}
ManifestType: defaultLocale
ManifestVersion: 1.9.0
`,
);

write(
  "scoop/mdview.json",
  JSON.stringify(
    {
      version,
      description: "A light, offline Markdown viewer and editor that opens the files your AI agents write.",
      homepage: HOME,
      license: "MIT",
      architecture: {
        "64bit": { url: `${download(exeName)}#/dl.7z`, hash: exeHash.toLowerCase() },
      },
      pre_install: 'Remove-Item "$dir\\$PLUGINSDIR", "$dir\\uninstall.exe" -Recurse -Force -ErrorAction SilentlyContinue',
      post_install: '& "$dir\\mdview.exe" --register',
      pre_uninstall: '& "$dir\\mdview.exe" --unregister',
      bin: "mdview.exe",
      shortcuts: [["mdview.exe", "MDView"]],
      checkver: { github: HOME },
      autoupdate: {
        architecture: { "64bit": { url: `${HOME}/releases/download/v$version/MDView_$version_x64-setup.exe#/dl.7z` } },
      },
    },
    null,
    2,
  ) + "\n",
);

if (dmgHash) {
  write(
    "homebrew/mdview.rb",
    `
cask "mdview" do
  version "${version}"
  sha256 "${dmgHash.toLowerCase()}"

  url "${HOME}/releases/download/v#{version}/MDView_#{version}_universal.dmg"
  name "MDView"
  desc "Light, offline Markdown viewer and editor that opens the files AI agents write"
  homepage "${HOME}"

  app "MDView.app"
  binary "#{appdir}/MDView.app/Contents/MacOS/mdview"

  zap trash: [
    "~/Library/Application Support/app.mdview.desktop",
    "~/Library/Caches/app.mdview.desktop",
    "~/Library/WebKit/app.mdview.desktop",
  ]
end
`,
  );
}
