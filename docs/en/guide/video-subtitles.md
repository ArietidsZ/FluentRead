# Video & meeting translation

Follow YouTube and X videos or Google Meet, Teams and Zoom web meetings with bilingual captions, using accessible captions provided by the platform.

<GuideVisual kind="video" en />

## A video with subtitles

1. Make sure video subtitle translation is enabled.
2. Open a YouTube or X video and find the FluentRead icon just before the fullscreen button. On X, it stays between picture-in-picture and fullscreen when controls reappear or fullscreen changes.
3. Choose bilingual, translation-only, or original-only display.

FluentRead uses subtitle tracks or subtitle text provided by the page. It cannot guarantee translations where no subtitles are available. The subtitle translation service follows the webpage service by default; you can select a separate service in video translation settings.

<details class="guide-details">
<summary>Caption timing and pretranslation</summary>

When a YouTube or X subtitle timeline is available, FluentRead prioritizes the current caption and pretranslates up to eight distinct upcoming texts. The window normally covers the next 10 seconds for machine translation or 30 seconds for AI services, and expands for faster playback. Native tracks start prefetching as soon as they load. Repeated entries and expired captions do not consume upcoming slots, and seeking updates the prefetch window.

The subtitle menu also works in YouTube fullscreen. Prefetched originals and translations appear together in the same update. Previous translations clear when captions change, disappear, or you seek. At startup, after seeking to an untranslated position, or while the service is still responding, the original remains available; the translation is added only while its caption is still current.

On X, bilingual lines always appear together. A caption without a ready translation waits for the matching result while playback continues; expired results are discarded. Original-only mode displays immediately. If translation fails, the current original remains available and the menu offers a retry.

For YouTube rolling captions, FluentRead matches the newly appearing sentence and playback time to prefetched translations without waiting for the previous line to scroll away. When no subtitle timeline is available, it also submits text during continuous updates. Translation speed still depends on the selected service.

To correct captions that are late or early, open **Subtitle timing** in the FluentRead menu on the playback page and click **0.5 s earlier / 0.5 s later**. Negative values advance subtitles; positive values delay them, up to ±10 seconds. **Reset timing** returns to zero. The setting is saved for subsequent videos and moves both subtitle lines together. Playback position and downloaded subtitle timestamps stay unchanged. The menu indicates when timing adjustment is unavailable.

</details>

<details class="guide-details">
<summary>An X video without subtitles</summary>

## An X video without subtitles

The desktop Chrome / Edge extension can try local AI transcription:

1. Download the Tiny or Base speech model in video settings. Initial downloads are about 100 MB and 150 MB respectively; extra runtime files may be needed later.
2. Return to the X player and choose to generate AI subtitles.
3. Wait for recognition. You can stop the job. Once recognition finishes, the timeline is available immediately; translations are fetched near the playback position. Original-only mode does not request translations.

Tiny and Base are multilingual models. For Chinese speech, choose **Video settings → Spoken language → Chinese**; Base is the available option that prioritizes recognition quality. Auto detection waits for two sufficiently long, confident audio windows to agree before fixing the language for the video. Repeated decoding output is retried once with stronger repetition controls; if it remains corrupt, the job reports an error rather than displaying or caching it.

Audio recognition runs locally; recognized subtitle text still goes to your translation service. Model downloads require a network connection. Processing depends on video length and your computer. Videos up to 20 minutes are supported; some formats or restricted media cannot be read.

Model downloads try ModelScope first, then Hugging Face and two mirrors after connection or transfer failures. Existing files are reused. Speech models are downloaded separately from the extension package.

Moving the pointer away and back, rebuilding playback controls, temporarily hiding the video, or attaching its thumbnail does not discard the current AI timeline. A different media identity clears the previous video’s subtitles.

You can generate subtitles directly from the Home feed. FluentRead recovers loaded audio manifests for the current media without mixing other preloaded posts. It prefers the master playlist’s audio rendition and checks the initialization segment for an audio track before downloading media segments. Reading or decoding failures continue with other known playlists for the same video. If audio remains unavailable, the menu suggests opening the post or refreshing the page and retrying. Switching videos clears the previous video’s error, progress and model prompt.

</details>

<details class="guide-details">
<summary>Display and download</summary>

## Display and download

Adjust subtitle size, background, position, and width in video appearance settings. X subtitles stay within the video picture, with long lines wrapping inside portrait videos. Their position updates when the player resizes or enters fullscreen, and they try to avoid visible playback controls.

Use the menu to show or hide subtitles and download them. Completed X transcripts are cached locally for a limited time, so reopening the same video usually avoids another transcription. The cached timeline is restored immediately, and bilingual lines appear together as each current translation becomes ready. The cache count refreshes when you return to video settings. Use re-recognition or clear the video cache to start fresh.

</details>

<details class="guide-details">
<summary>Missing or inaccurate subtitles</summary>

## Missing or inaccurate subtitles

Check that subtitles are enabled and the video has a native track. For X AI subtitles, confirm the model download and try specifying the spoken language.

An empty transcription is a speech recognition result, separate from a translation failure. Try Base if you are using Tiny. If Base is already selected, check for clear speech and the correct spoken language before retrying. Videos without speech cannot produce AI subtitles.

Recognition can mishear names or background audio, and translations can be wrong. Check important details against the original subtitles and audio.

Open **Subtitle options → Regenerate this video** to bypass its saved subtitles without clearing other videos or downloading an already installed model again. Existing subtitles remain available until model confirmation. Translation failures keep the recognized original and timeline; use **Retry** to recover without repeating speech recognition.

</details>

<details class="guide-details">
<summary>Supported platforms and default options</summary>

FluentRead also reads captions in Udemy and Disney+ videos and in Teams, Zoom and Google Meet web meetings.

Under **Video translation settings → General**, two options are enabled by default and saved automatically:

- **Automatically enable bilingual meeting captions** attempts to enable available platform captions. You can disable this option and enable native captions yourself. Turning off video translation or hiding FluentRead captions restores the native display.
- **Prefer human subtitles** uses readable human subtitle tracks in the target language on YouTube, Udemy and Disney+. Missing tracks, inaccessible tracks and gaps fall back to translating the original captions. The source track is preserved.

Meeting support applies to browser web clients, including Zoom's `/wc/` client. The platform, host or account must permit captions. FluentRead does not enable recording or transcription and cannot provide speech captions when the platform supplies none. Teams caption activation follows its meeting More actions and Language and speech menus when available; enable captions manually if controls have changed.

Udemy and Disney+ support uses displayed captions and available subtitle tracks. Their caption panel supports bilingual, translation only, original only, off and translation retry, including fullscreen. Track availability can depend on the player, account, region and content restrictions. This feature does not bypass access restrictions or generate audio captions for videos without subtitles.

Read original subtitles and translations together on YouTube and X, or show just one language.

The open subtitle menu stays available when X hides its playback controls. Switches, display modes, and AI subtitle status update as you use them. Click outside, use the close button, or press Esc to close it. Arrow keys move focus inside the menu without seeking the video.

The compact X menu puts display modes first. **Subtitle options** contains timing, downloads, and regeneration; use the back arrow or Esc to return. The source line shows native captions, saved local subtitles, or AI subtitles. When none are detected, it explains how to proceed and disables empty downloads. Native captions take priority over automatically restored AI subtitles; explicitly generated AI captions keep their own timeline.

</details>

## Related guides

- [All guides](/en/docs/)
- [Troubleshooting](/en/guide/faq)

## Settings preview

Video appearance settings show a live sample on the left, with visibility, bilingual or single-language display, skins, size and position on the right. Both work areas have equal width and height on desktop. The compact preview card keeps a 16:9 video frame visible while you scroll through the controls. Narrow screens show the preview above the settings. Fine-tuning controls are directly visible. Hiding subtitles preserves your appearance and translation preferences. The example reads no video and sends no translation requests. X local recognition and model downloads remain in their own section.
