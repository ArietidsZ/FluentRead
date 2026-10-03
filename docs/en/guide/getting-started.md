# Installation

Install FluentRead and read your first bilingual paragraph. Free translation needs no API key.

<GuideVisual kind="install" en />

## Install

Add FluentRead from your browser’s official store:

| Browser | Official installation |
| --- | --- |
| Chrome | [Chrome Web Store](https://chromewebstore.google.com/detail/djnlaiohfaaifbibleebjggkghlmcpcj) |
| Edge | [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/kakgmllfpjldjhcnkghpplmlbnmcoflp) |
| Firefox | [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB/) |

Pin the icon to the toolbar. Refresh pages that were already open before installation.

<details class="guide-details">
<summary>Mobile, userscripts & Thunderbird</summary>

On **Edge for Android** versions that offer extensions, find FluentRead through the extension menu, then open it from the extensions list and translate the page. Use the menu or an enabled floating ball; desktop shortcuts and context menus do not apply. Edge extension availability on iPhone/iPad needs separate confirmation.

Other installation options: [Userscript](/en/guide/userscript) · [Thunderbird email translation](/en/guide/thunderbird).

</details>

## Your first translation

### 1. Open an article

Start with a normal news, blog, or forum webpage. Browser settings and extension stores do not allow extension translation.

### 2. Pick your language

Open FluentRead from the toolbar. Keep the source on **Automatic detection** and choose your target language. The default is **Simplified Chinese**; change it to the language you want. Keep **Free translation service**.

<figure class="doc-figure">
<a href="/screenshots/ui/en-US/popup.webp" target="_blank" rel="noopener"><img class="doc-screenshot popup" src="/screenshots/ui/en-US/popup.webp" width="760" height="984" alt="Actual FluentRead menu: choose a target language and free translation before translating the page" loading="lazy" /></a>
<figcaption>The actual extension menu. Open the image for full resolution.</figcaption>
</figure>

### 3. Translate the page

Choose **Translate this page**. Translations appear below the original. Scroll down to continue reading.

<BrandReader en />

### 4. Go back to the original

Choose **Restore this page**. Restore before translating again with another language or provider.

<details class="guide-details">
<summary>Chinese scripts and text that stays unchanged</summary>

Simplified and Traditional Chinese are separate targets. Content already matching the chosen Chinese script stays unchanged. A few abbreviations such as AI, CoT, or OpenAI, and file names such as PDF, ePub, DOCX, and Markdown, do not cause a Chinese paragraph to be translated again. Script conversion, mixed scripts, complete foreign-language passages, and uncertain detection still attempt translation.

</details>

## Just one sentence?

Enable **Selection translation**. Select a sentence and click the nearby FluentRead icon. Switch to [card mode](/en/guide/deepseek-harness) for dictionary lookup or sentence explanations.

For one paragraph, hover over it and press **Control**: [Hover translation](/en/guide/hover-translation).

## Nothing happened?

Make sure the extension is on, refresh a normal webpage, and retry. If the free service is busy, retry later or [switch providers](/en/config/translation-engines). Then follow [Troubleshooting](/en/guide/faq).

## Next steps

- [Choose your next task](/en/docs/)
- [Adjust translation appearance](/en/config/appearance)
- [Connect your own AI provider](/en/config/translation-engines)
