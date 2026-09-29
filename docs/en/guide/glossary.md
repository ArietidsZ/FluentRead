# Glossaries

Glossaries specify consistent translations for names, products, and technical terms. Entries guide AI translations; the separate learning collection is used for study.

## Create a glossary

1. Open **Glossaries** and enable the feature.
2. Create a glossary or add a built-in topic for AI, software, finance, research, or product names.
3. Enter source and target terms. Leave the translation empty to preserve the original.
4. Save the entry, then paste a sentence into **Match preview** to check which terms apply.

Glossary settings save automatically; entry edits require **Save**. Saved changes apply to the next translation. Restore existing webpage translations before translating again.

## Which services use it?

Supported AI translation services use glossary terms. Machine services such as Microsoft, Google, DeepL, DeepLX, and Chrome built-in translation currently do not. AI may still ignore a preferred translation, so check important terms.

## Use it in the right places

Choose source and target languages and optional website scope. Empty website scope applies globally. Website-specific glossaries do not apply to local documents without a URL.

When multiple glossaries define the same source term, earlier glossaries take priority. Adjust their order or separate subject areas. A glossary name is for organization; it does not make the AI infer the article’s subject.

## Import and keep a backup

Import CSV, TSV, or JSON from a file or pasted text. Imports create new glossaries rather than replacing existing ones. Check the preview before confirming.

File imports detect UTF-8, BOM-marked UTF-16, and common GB18030 encodings from their bytes, so CSV files saved by Excel on a Chinese system are not silently read as mojibake.

JSON keeps complete glossary settings; CSV and TSV are useful for spreadsheet editing. Glossaries are also included in configuration backup and restore.

## Data

Editing and match previews run locally. Translation sends only terms matched in the current source and their requested translations, not the entire glossary. Terms can contain business information, so choose your service accordingly.

## Managing and checking glossaries

The settings page separates **My glossaries**, **Built-in glossaries**, and **Match preview**. Built-in cards show actual sample entries; adding a glossary creates an editable copy without changing the master switch. New custom glossaries default to the current translation target language. Existing language scopes are preserved.

Entries come first in the editor. Expand **Glossary settings** to change the name, languages, website scope, export format, or delete the glossary. Settings save automatically; entry edits require **Save**. Entry drafts survive switching glossaries within the same settings page. Save them before closing the page. Switching to another entry asks before discarding unsaved changes.

Matching source terms in the same glossary are flagged with an **Edit existing entry** action. Distinct case-sensitive spellings can coexist. Imported entries are not silently merged or removed. Across glossaries, earlier glossaries still take priority.

**Match preview** uses the same scope and matching rules as translation and explains excluded glossaries: disabled, empty, source/target language mismatch, or a missing/out-of-scope URL. Automatic source language checks terms directly. Preview remains available when the master switch is off, but actual translation will not use the glossary. It makes no translation requests and cannot guarantee model compliance. Document and video selections may further restrict which glossaries apply.
