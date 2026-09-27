# Use a script manager

If you use Tampermonkey, Violentmonkey, Via, or Safari Userscripts, you can install the FluentRead userscript for core webpage translation. Support depends on your browser and script manager version.

## Install

Open the [FluentRead Greasy Fork page](https://greasyfork.org/en/scripts/482986), follow your script manager’s installation prompts, then open a regular webpage. Confirm that the script is enabled.

The Greasy Fork release may lag behind the GitHub source. Check the version on the installation page and in script settings when reporting a problem.

## What it can do

Translate pages and restore originals; translate selected or hovered text; use supported gestures, input translation, copying, and read-aloud; choose free, cloud, AI, or custom services. Preferences are saved in the script’s own settings.

At installation, the script manager downloads fixed versions of UI libraries from jsDelivr. Chinese and English UI text ships with the script. On first use, Japanese, Korean, French, Russian, and Spanish UI text is downloaded from jsDelivr or GitHub and cached in the script manager’s private storage. These resource requests contain no page text or API keys. If you are offline before a language is cached, the UI temporarily falls back to Chinese.

## How it differs from the extension

The script manager and webpage permissions limit available features. Image recognition, area capture, Chrome’s built-in translation, background features, and video subtitles may not be available. Behavior can vary between script managers.

## Data

Configuration stays in the script manager’s private storage. Translation text goes to the service you select. UI libraries and language files come from jsDelivr or GitHub as described above. Keep credentials out of shared screenshots and public feedback; see [Data & privacy](/en/guide/privacy).
