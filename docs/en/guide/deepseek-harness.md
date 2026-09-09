# AI reading card

The AI reading card explains selected text, analyzes sentence structure, describes usage, and provides exercises. Follow-up questions retain the conversation context.

## DeepSeek Harness

FluentRead is open source, and the reading card integrates a **browser adaptation of the DeepSeek Harness session core**. It supports contextual follow-up questions and reading history.

The adaptation uses the upstream conversation-event and message organization components. FluentRead connects these to your selection, AI model, and learning records. You can choose your own AI service; it does not require a DeepSeek model. [FluentRead source](https://github.com/FluentRead/FluentRead) · [DeepSeek Harness attribution and license](https://github.com/FluentRead/FluentRead/blob/main/public/third-party-notices/deepseek-harness-MIT.txt)

<a href="/screenshots/en/reading-card.webp" target="_blank" rel="noopener noreferrer"><img class="doc-screenshot" src="/screenshots/en/reading-card.webp" alt="The reading card explaining a selected sentence, with follow-up questions available" width="2560" height="1600" loading="lazy" /></a>

## Setup

Open **Settings → Translation card**, enable it, and choose a configured AI service and model. Enter connection details under [Translation services](/en/config/translation-engines).

## Use it on a webpage

Double-click a word or select a sentence, then choose an action:

| Action | Use it when |
| --- | --- |
| Understand | You want the meaning, tone, or implied context |
| Analyze sentence | You need the main clause and how the pieces fit |
| Usage | You want natural expressions and common combinations |
| Practice | You want to try using what you’ve just read |

By default, selecting text only shows the actions; clicking an action starts AI. Under **Open the reading card**, you can also choose:

- **Hover with delay**: hover over a learning action in the selection toolbar to open it and start generating. Moving away or clicking elsewhere cancels the wait. Adjust the delay from 200 to 3000 milliseconds.
- **Keyboard shortcut**: select text, then press **Alt+R** (Option+R on Mac) to open your preferred action. Click the key combination in settings to record a different shortcut.

Click another webpage control or press Escape to close the toolbar and card. A retained selection will not reopen them; select text again or deliberately press the shortcut to reopen.

Continue with a follow-up question, or use the speaker beside the original to listen; click again to stop.

If you selected one word and the card offers to understand the whole sentence, clicking that option expands the analysis to its sentence.

## Collections and reading history

Save a word, phrase, or sentence to the [learning center](/en/guide/vocabulary-book). You can save the original before the AI response finishes.

The card’s history and the learning center’s reading history show the same conversations. In regular windows, conversations stay locally for 30 days. You can reopen, continue, or delete them. Opening history does not make a new AI request.

## Adjust the explanation

Choose your learning level, explanation length, and preferred actions. Hide actions you do not use.

The source scope controls what the model can reference. The default permits the current paragraph; choose selection-only to send just the selected text. More context can help with references, but sends more text.

You can expand the prompt editor to adjust the general instruction and each action. Clear a template or restore its default to reset it. Changes apply to the next analysis.

Default prompts follow the interface language and support Chinese, English, Japanese, Korean, French, Russian, and Spanish. Empty templates and restored defaults use the current interface language; custom text is preserved. The target language controls the response language independently.

## Optional learning memories

If enabled, learning memories can retain preferences or notes you choose to keep and use them in later explanations. You can review, disable, delete, or clear them. Memories used for a cloud explanation are sent to the selected AI service.

## Data and accuracy

An action or follow-up sends the selection, permitted context, and necessary conversation to the selected AI service. Private windows neither read nor save local conversation history.

AI can misread tone, grammar, or facts. Compare with the original or ask why. See [Data & privacy](/en/guide/privacy).

### Switching learning actions

Within the same card, switching from Understand to Analyze sentence and back restores the completed answer. Follow-up questions continue that action’s conversation. Choose **Regenerate** for a new explanation. Changing the source, model, answer language, or explanation settings invalidates earlier results. After closing the card, you can continue from Reading history.

When paragraph context is allowed, the model receives that paragraph with the selected text to help resolve references. Selection-only mode sends only the selected text. With limited context, the assistant should explain what the text supports first, then briefly identify any ambiguity.
