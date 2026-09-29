# Selection translation

Select text to see its translation beside the original. The former translation card is now part of Selection translation, with one entry, activation method and master switch.

## Choose a default view

Open **Settings → Selection translation** and enable the feature.

- **Simple translation** shows the source and translation with copy and speech controls.
- **Card mode** adds dictionary pronunciations and word classes, with optional AI learning actions.

Switch views inside a popup at any time, reusing its translation. This changes only the current selection; the next selection uses your saved default. The settings preview uses fixed examples and sends no requests.

Simple translation keeps language and view controls in one compact toolbar, with copy and speech controls beside the text. Dictionary cards put pronunciations on a shared row when space allows.

Simple translation uses the default translation service. English dictionary lookup does not require AI. Dictionary meanings are grouped by word class; these describe possible uses, not necessarily the word’s role in the current sentence. If lookup fails, the translation remains available.

## Activation and display

Both views share the icon, dot, direct popup, hover-over-icon, shortcut and context-menu activation settings. Hovering opens the popup after the configured wait; moving away cancels it. Shortcuts and context-menu mode do not show an extra toolbar.

For fewer interruptions, keep the default **Show icon** and click only when needed. A custom shortcut or context-menu mode hides floating entries entirely. Direct popup is suited to repeated lookups; it can interrupt people who select text while reading. Upgrades preserve your chosen activation method.

**Dismiss when continuing to read** is on by default. Scrolling the page or copying the original dismisses the popup, and moving away from an unopened entry hides it after a short grace period. Native selection and copying remain intact. Scrolling or copying within the card keeps it open. Turn this preference off to compare a translation while scrolling the page.

Escape or a click elsewhere closes the popup. A dismissed selection does not reopen by itself. Disabling Selection translation stops both views while keeping learning preferences.

## Optional AI explanations

Enable **AI explanations**, expand **Service & learning preferences**, and select a configured AI service and model. Opening a card does not call AI. Choose an action to request an explanation:

- **Understand** explains meaning, tone and references.
- **Parts of speech & syntax** explains the sentence structure and labels source fragments.
- **Usage** teaches natural expressions and collocations.
- **Practice** provides a short exercise.

Click an annotated fragment to see its word class, meaning and syntactic role. A noun may be a subject in one sentence and an object in another. The default grammar prompt requests a compact table that the interface matches to the source in order. Unmatched or incomplete output, and custom formats, remain readable as ordinary text. AI analysis may be wrong; check the original when in doubt.

Completed answers are reused when switching learning actions within the current card. Use Regenerate for a new answer, return to the translation, or ask a follow-up. Changing the source, model, language or learning preferences invalidates related cached answers.

## Context and records

Under **Context, learning memory & instructions**, choose the selection alone or allow its paragraph. This does not read the entire page. Learning memory is optional and off by default. Custom prompts are preserved.

Save expressions to the [Learning center](/en/guide/vocabulary-book). Reading conversations stay on this device for 30 days. Viewing records sends no model request. Private windows do not read or save history. See [Data and privacy](/en/guide/privacy).

## Existing preferences

Upgrades preserve services, custom models, actions, context and prompts. Existing standalone cards migrate to the unified feature, including their activation method when ordinary selection translation was disabled. Old settings links still work.

Learning conversations continue to use the browser adaptation of DeepSeek Harness, without requiring a DeepSeek model. [Source and license](https://github.com/FluentRead/FluentRead/blob/main/public/third-party-notices/deepseek-harness-MIT.txt)
