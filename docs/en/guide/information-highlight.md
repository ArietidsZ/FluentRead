# Information highlighting

Information highlighting marks words worth noticing in longer passages. The complete text remains readable, selectable and copyable, with its original layout.

## Use it

1. Open FluentRead's popup and choose **Information highlighting**.
2. Enable it for the current page, then choose a mode and density.
3. Text is analyzed near your reading position. Turn it off at any time to clear these highlights.

The enabled state belongs to the current page. Mode, density and appearance are saved under **Settings → Translation settings → Reading assistance → Information highlighting** without enabling other pages.

## Modes

| Mode | Purpose | Processing |
| --- | --- | --- |
| Keywords | Quickly spot topic words | Lightweight local algorithm; no model download |
| Surprisal | Notice words that are less predictable in context | A local language model computes word probabilities; download required |

Both modes process page text locally. Downloading a model contacts its hosting service; scoring does not send page text there.

Surprisal is `−log₂ P(word | preceding text)`. A higher value means the model found the word harder to predict. It does not establish importance, correctness or factual accuracy. Names, rare words and typos can all score highly; unmarked conditions and negations may still matter.

## Appearance and performance

Choose low, medium or high density, amber, mint or blue, and a soft background or underline. Appearance and density changes reuse existing scores.

Model download starts only after you choose the download action. Model mode requires supported WebGPU capabilities. An unavailable page or model displays a reason; you can choose Keywords manually. Page text is never automatically sent to a cloud scorer.

Long pages prioritize nearby text and defer analysis during fast scrolling. Turning the feature off cancels work and discards late results. Changes to page text trigger fresh analysis. Editors, forms, code and formulas are excluded from normal body highlighting.

CSS Custom Highlight API support is required; unsupported browsers keep the normal page and show an unavailable state.

## Source

The design draws on [InfoLens](https://github.com/dqy08/InfoLens/tree/205c45b8fac0b2ded7f8aac764fcba5f6b0719db). FluentRead implements it in its own Vue and WXT architecture, with no runtime dependency on the reference repository. Keyword ranking and language-model surprisal remain distinct methods.

In the FluentRead PDF reader, enable **Information highlighting** from the toolbar. It uses the selectable text layer and preserves the original page image and layout. Scanned pages without a text layer are excluded.
