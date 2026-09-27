# Use a script manager

If you use Tampermonkey, Violentmonkey, Via, or Safari Userscripts, you can install the FluentRead userscript for core webpage translation. Support depends on your browser and script manager version.

## Install

Open the [FluentRead Greasy Fork page](https://greasyfork.org/en/scripts/482986), follow your script manager’s installation prompts, then open a regular webpage. Confirm that the script is enabled.

The Greasy Fork release may lag behind the GitHub source. Check the version on the installation page and in script settings when reporting a problem. Automated runtime checks currently cover Chrome with Violentmonkey; Safari Userscripts and Via still need device testing.

## Safari Userscripts setup and troubleshooting

1. Install Userscripts from the App Store and enable its Safari extension. On iPhone/iPad, go to Settings → Safari → Extensions → Userscripts, allow access to all websites, and choose Always Allow in Safari. On macOS, grant the extension access to the sites you visit.
2. On iPhone/iPad, set a scripts directory in the Userscripts app first; macOS can use the default directory. Open the installation page above in Safari and use the Userscripts toolbar installation prompt to save and enable the script. Stay online while the manager downloads its `@require` UI libraries.
3. In the Userscripts popup, confirm Enable Injection is on and FluentRead is matched and enabled for the current site. Reload a regular HTTP(S) page. Open FluentRead settings from its page floating button; Safari Userscripts does not provide script menu commands.
4. If you added or edited the script directly in its directory, open the Userscripts popup at least once to refresh its file list. If the floating button is still missing, check the script version, site permission, URL match, and whether the required libraries downloaded. Include Safari, system, and Userscripts versions and the affected URL in a report.

These steps follow the [official Userscripts installation and metadata documentation](https://github.com/quoid/userscripts/tree/release/4.x.x). Runtime behavior on Safari still needs device verification.

## What it can do

Translate pages and restore originals; translate selected or hovered text; use supported gestures, input translation, copying, and read-aloud; choose free, cloud, AI, or custom services. Preferences are saved in the script’s own settings.

At installation, the script manager downloads fixed versions of UI libraries from jsDelivr. Chinese and English UI text ships with the script. On first use, Japanese, Korean, French, Russian, and Spanish UI text is downloaded from jsDelivr or GitHub and cached in the script manager’s private storage. These resource requests contain no page text or API keys. If you are offline before a language is cached, the UI temporarily falls back to Chinese.

## How it differs from the extension

The script manager and webpage permissions limit available features. Image recognition, area capture, Chrome’s built-in translation, background features, and video subtitles may not be available. Behavior can vary between script managers.

## Data

Configuration stays in the script manager’s private storage. Translation text goes to the service you select. UI libraries and language files come from jsDelivr or GitHub as described above. Keep credentials out of shared screenshots and public feedback; see [Data & privacy](/en/guide/privacy).
