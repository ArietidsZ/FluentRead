# Image translation

Image translation recognizes text inside webpage images and overlays the translation on the image. It is off by default and can be enabled in settings. Once enabled, hover over an image for about 0.6 seconds to reveal a faint icon in its lower-left corner. The icon becomes clear when you hover over it; click to translate.

The hover entry skips common avatars, icons, logos, emoji, video previews, and small images where it can identify them. Video previews on sites such as X/Twitter can be skipped before playback starts, using player or thumbnail markers. Enlarging a small image may still leave the entry hidden. If an image you want to translate has no icon, use its context menu or open a clear original and try again.

## Continuous manga translation

The manga reader on [MANGA Plus by SHUEISHA](https://mangaplus.shueisha.co.jp/) is supported. Enable webpage image translation under **Manga/images → Translation entries**, leave the manga button enabled, and enable the floating ball. A manga icon appears beside the floating ball in a chapter.

- Click once to enable translation for the current chapter. Loaded pages entering the viewport are processed one at a time. Scrolling continues the session; local manga models are prepared automatically with progress on first use.
- Click again to show originals and pause new work. Another click restores translations and resumes. Visible decoded results switch immediately; nearby results use a cache bounded by image count and pixels. Evicted pages may need processing again.
- Failed pages retain their originals and individual retry controls. Other visible pages can continue. Changing chapters, disabling image translation, or leaving the page cancels old work and restores originals.

This uses your image translation service and language settings. FluentRead adds no membership or image quota; the selected service's own limits and costs still apply. MANGA Plus is the current adapted reader. Other websites can use single-image or area translation; another product's site list does not represent FluentRead support.

Manga uses local PaddleOCR. Closed light speech bubbles are enlarged and recognized individually, nearby lines are grouped into dialogue, and translations use bounded font sizes and wrapping. Local LaMa repairs original lettering on complex backgrounds. Ordinary images and area recognition retain their own OCR language packs. Small or tilted text, decorative fonts, names, and background repair can still be imperfect; use originals or **Text → Compare original** to check.

### Download manga models

Under **Manga/images → Text recognition**, view model status, choose a source, import files, or clear models. Recognition needs about 30 MB. The first complex background also needs an inpainting model of about 197 MB. Settings show the current download source and received bytes; the manga page shows preparation progress.

By default, Hugging Face is tried first, then a backup mirror after connection failure, prolonged inactivity, or integrity failure. You can prefer the mirror instead. Completed verified files are retained, so retrying after cancellation or failure only prepares missing files. An interrupted individual file must restart. Clearing manga models preserves ordinary OCR packs, translation configuration, and source preferences.

For restricted networks, expand **Get offline model files**, obtain the four matching files through an accessible source, and select them together with **Import downloaded models**. File names, complete sizes, and SHA-256 hashes must match; imported files stay local and are never uploaded. Once the models are present, recognition and repair can run offline. Your text translation service still needs its own connection.

The backup mirror is an independent third party. Every source uses the same fixed versions and integrity checks. Multiple sources and offline import accommodate differing networks in China, the United States, and other regions; availability still depends on local networks and services and cannot be guaranteed for every country or carrier at all times.

## Translate one image

1. Make sure image translation is enabled. Click the icon near the image’s lower-left corner, or use the image’s context menu.
2. For a new source language, follow the prompt to download its recognition pack and translate.
3. Wait for recognition and translation. Choose cancel if you want to stop.
4. Switch between original and translated image, or open **Text** in a separate reading panel. Compare the recognized original and translation, and copy either the translation or both. Long text remains readable even for small images.

Canceling a translation does not remove downloaded language packs. Later images can reuse them. If text stays unchanged, you can still read and copy the recognized result.

Numbers, symbols, URLs, version numbers, and clear model identifiers are kept without separate translation requests. Ordinary prose on the same line is still translated. Images with more text require more segments, and the selected service affects the time needed. If a passage fails to translate, the original image stays available for retry; identifiers that need no translation do not cause the whole image to fail.

Language settings show the packs needed for your source language, downloaded packs, and active tasks first. Expand other languages as needed. Download progress is shown per pack; you can leave the settings page and return later. Completed packs are kept when another pack fails. Retrying downloads only missing packs. Removed packs need to be downloaded again.

If the translation connection is interrupted, it retries once automatically and remains cancelable. If it still fails, choose **Retry**. After an extension update or reload, refresh the webpage before trying again.

## Cross-origin images

Images on public HTTPS CDNs can also be translated. When the webpage cannot read their pixels, the extension verifies the currently selected image and reads it without login credentials. Canceling, changing the image, or leaving the page invalidates the previous request.

Images that require login credentials, redirect to another address, or use local or intranet sources may be unreadable. Try [area translation](/en/guide/area-translation) for visible text. Files over 16 MiB, access refusals, and non-image responses report their specific cause.

## Choose the source language

Choose the recognition source language in the language-pack manager. This setting is shared with webpage and area translation. The recognition pack must match the image’s language. Automatic detection prepares Simplified Chinese, Traditional Chinese, English, and Japanese by default. Other supported languages require selecting the source language and downloading its pack.

For an English-only image, choosing **English** can reduce recognition time. Keep **Automatic detection** for mixed languages. Completed recognition results are reused, and simultaneous requests for the same image share recognition. Canceling one request does not interrupt the others. Initial language-pack downloads still depend on network speed.

When the source language is automatic or Japanese, the Japanese pack recognizes both horizontal and vertical text. Vertical columns in a manga speech bubble are joined right to left into one passage before translation.

The current translation service and target language are used. Hover and context-menu entries can be turned off separately in image settings.

## Small or blurry text?

Open a clear original if possible. Decorative fonts, complex backgrounds, tables, and vertical text in languages other than Japanese are harder to recognize. Check names, numbers, and units.

Long translations may appear small inside the picture; use the text view to read them fully. Background repairs may leave marks, and you can always restore the original.

For one small part, try [area translation](/en/guide/area-translation). Unreadable image sources and restricted pages may not work.

## What gets sent?

Recognition happens locally. Recognized text goes to the selected translation service; image pixels are not uploaded as part of text translation. Initial language-pack downloads require a network connection. See [Data & privacy](/en/guide/privacy).

## Next steps

- [All guides](/en/docs/)
- [Troubleshooting](/en/guide/faq)
