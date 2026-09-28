# Use a script manager

If you use Tampermonkey, Violentmonkey, Via, or Safari Userscripts, you can install the FluentRead userscript for core webpage translation. Support depends on your browser and script manager version.

## Install

Open the [FluentRead Greasy Fork page](https://greasyfork.org/en/scripts/482986), follow your script manager’s installation prompts, then open a regular webpage. Confirm that the script is enabled.

The Greasy Fork release may lag behind the GitHub source. Check the version on the installation page and in script settings when reporting a problem. Automated runtime checks currently cover Chrome with Violentmonkey; Safari Userscripts and Via still need device testing.

### Build the standalone script from source

To try fixes that have not reached Greasy Fork, install the repository dependencies, run `pnpm test:userscript:standalone`, and import `.output/userscript-standalone/fluent-read.user.js` through your manager's file installation option. This build includes Vue, the UI libraries, and the gzip fallback needed by older browsers. It needs no `@require` downloads at installation; translation services and first use of other UI languages still need a network connection. Install either the standalone or slim build to avoid running both.

`pnpm test:userscript` also produces a smaller `.output/userscript/fluent-read.user.js`. Its pinned `@require` dependencies must download during installation. Violentmonkey has sometimes run that build before its dependencies were ready when installed from a file; the standalone build passed an immediate first-page test in an isolated real manager. Neither build is the version currently published on Greasy Fork.

The repository’s **standalone build** opens the same full Options center used by the browser extension. Use the floating button or the script manager menu to open it in a separate tab at the current site’s URL. If a new tab is blocked, it opens in an isolated overlay on the current page without changing the site’s URL. Language, service, and appearance preferences are kept in the script manager’s private storage. Image translation, area translation, video subtitles, writing assistance, translation statistics, and model usage sections show an unavailable message in the userscript. The right-click menu and extension popup layout controls show an explanation too, so they cannot save settings that have no effect. The **slim build** keeps its compact settings panel. Check the installed version before expecting these changes from the Greasy Fork listing.

The standalone build exceeds [Greasy Fork’s direct publication size and code rules](https://greasyfork.org/en/help/code-rules). For now, install a locally built file through your script manager; a successful repository build does not mean it has been published on Greasy Fork.

## Safari Userscripts setup and troubleshooting

1. Install Userscripts from the App Store and enable its Safari extension. On iPhone/iPad, go to Settings → Safari → Extensions → Userscripts, allow access to all websites, and choose Always Allow in Safari. On macOS, grant the extension access to the sites you visit.
2. Confirm the scripts directory in the Userscripts app. Recent iPhone/iPad versions normally create a default directory, and macOS can use its default directory too. For the Greasy Fork release, open the installation page above in Safari and use the Userscripts toolbar prompt to save and enable it. To try the standalone build from source, put its `.user.js` file in that scripts directory, then open the Userscripts popup to refresh the file list. Stay online during installation of the slim build while the manager downloads its `@require` UI libraries.
3. In the Userscripts popup, confirm Enable Injection is on and FluentRead is matched and enabled for the current site. Reload a regular HTTP(S) page. Open FluentRead settings from its page floating button; Safari Userscripts does not provide script menu commands.
4. If you added or edited the script directly in its directory, open the Userscripts popup at least once to refresh its file list. If the floating button is still missing, check the script version, site permission, URL match, and whether the required libraries downloaded. Include Safari, system, and Userscripts versions and the affected URL in a report.

These steps follow the [official Userscripts installation and metadata documentation](https://github.com/quoid/userscripts/tree/release/4.x.x). Runtime behavior on Safari still needs device verification.

## What it can do

Translate pages and restore originals; translate selected or hovered text; use supported gestures, input translation, copying, and read-aloud; choose free, cloud, AI, or custom services. Preferences are saved in the script’s own settings; the repository’s standalone build has the full Options center.

For the slim build, the script manager downloads fixed versions of UI libraries from jsDelivr at installation; the standalone build includes them. Chinese and English UI text ships with both. On first use, Japanese, Korean, French, Russian, and Spanish UI text is downloaded from jsDelivr or GitHub and cached in the script manager’s private storage. These resource requests contain no page text or API keys. If you are offline before a language is cached, the UI temporarily falls back to Chinese.

## How it differs from the extension

The script manager and webpage permissions limit available features. Image recognition, area capture, Chrome’s built-in translation, background features, and video subtitles may not be available. Behavior can vary between script managers.

## Data

Configuration stays in the script manager’s private storage. Translation text goes to the service you select. UI libraries and language files come from jsDelivr or GitHub as described above. Keep credentials out of shared screenshots and public feedback; see [Data & privacy](/en/guide/privacy).
