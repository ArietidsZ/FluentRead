# Area translation

Use area translation for words inside screenshots, charts, paused video frames, or comic bubbles. The result is a card with text you can copy.

## Select an area

1. Enable area translation and prepare the matching recognition language pack.
2. Press the area shortcut (**Shift+Z** by default) once, then drag around the area.
3. Release the pointer and wait for recognition and translation.
4. Copy the translation, expand the recognized original, or view the captured area.

If recognition packs are missing, choose **Download language pack and retry**. The required packs download and translation continues using the same capture. You can retry a failed download or press Esc to cancel.

Press **Esc** to exit. Choose a new selection to capture elsewhere, or retranslate to reuse the current capture with a changed service. Scrolling or resizing closes a finished result; selection mode itself is not cancelled by a page's own scrolling.

## Change the shortcut

In area translation settings, pick a preset under **Area translation shortcut**, or choose **Custom shortcut** and record your own. A single letter needs Ctrl, Alt/Option, or Shift, and a combination already used by hover, page, selection, input-box translation, or a quick translation profile is reported instead of saved. Until a custom recording succeeds, Shift+Z stays in use.

The shortcut never fires inside inputs, text areas, or editable regions, so it cannot interrupt typing.

## Standard or AI text enhancement?

Standard translation translates the recognized text directly and works well for clear, simple layouts.

AI text enhancement uses all recognized text in the area to tidy broken lines and translate. It needs a suitable general-purpose AI model. The model cannot see the screenshot or recover characters that recognition missed, so compare with the original.

The area service follows webpage translation by default, but you can choose it separately. Recognition packs are shared with [image translation](/en/guide/image-translation).

## Availability and data

Area capture currently works in the Chrome / Edge extension. Browser internal pages, restricted videos, and unreadable areas may not be captured. Other browsers and userscripts report their available capabilities.

The capture is cropped and recognized locally. Only recognized text goes to your selected translation service. For a translated image with its layout retained, use [image translation](/en/guide/image-translation).
