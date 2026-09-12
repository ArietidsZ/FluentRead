# Choose your translation service

FluentRead displays translations produced by your selected service. Use the default service or configure another machine translation provider, AI service, or local model.

## Which one fits?

| What you want | A starting point |
| --- | --- |
| Start immediately | Free translation service, without an API key |
| Use an existing provider | The corresponding Microsoft, Google, DeepL, or other service |
| Explain sentences, tone, or expressions | An AI service with a working model and credentials |
| Translate text locally | A running Ollama model or available [Chrome local translation](/en/guide/chrome-translator) |

FluentRead is free and open source. Third-party services may charge separately. A web chat subscription does not necessarily include API access.

## Connect and use it

1. Open translation services in settings and select the service to configure.
2. Enter its required key and address; select a model for AI services. Use details supplied by the provider.
3. Check the connection. This sends a short request and may use a small amount of your allowance.
4. Return to the extension menu, select the service, and try a sentence.

::: tip Configuring is not selecting the default
Clicking a service in the directory opens its configuration. It does not change the webpage default. Choose it from the extension menu after setup. Documents, subtitles, and the reading card have their own selections.
:::

<figure class="doc-figure"><a href="/screenshots/en/settings-services.webp" target="_blank" rel="noopener"><img class="doc-screenshot" src="/screenshots/en/settings-services.webp" width="2560" height="1600" alt="Translation service directory and connection settings" loading="lazy" /></a><figcaption>Configure a connection, then select the service you want to use.</figcaption></figure>

## Use several API keys

For a service with an API Key field, add one key per row using **Add a key** below the list. Existing single keys are kept. All rows use the same service address, model, region, and custom headers; use a separate custom service when those settings differ.

Requests are shared evenly at first. If a key fails, FluentRead tries another and temporarily reduces how often the failing key is used. Invalid keys and exhausted quotas can be paused. Priorities normally recover after 10 minutes; a rate limit with a server-provided waiting period follows that period instead. Changing keys does not bypass your configured request rate or total timeout. Health is temporary and resets when the extension's background process restarts.

**Check all keys** tests each distinct, filled row in order. Each row shows its own result and can be checked again. A failed row does not stop the rest. Empty rows and duplicates do not make extra requests. Checks send a short translation and may use a small amount of your provider allowance. Results describe that check, rather than guaranteeing future availability.

## The free service

The default fallback order is Microsoft, DeepLX, Google, then MyMemory. If one fails, the next may be tried, so translation styles can vary. Change the order or disable entries in settings, keeping at least one.

Free services have changing availability and allowances. Public interfaces and intermediaries have their own data policies. Keep only one entry, or select a standalone service, if you want requests to go to only that provider.

## DeepL

Choose API Free or API Pro and enter the matching key. A DeepL website subscription and a DeepL API plan are different products.

## DeepLX

Enter the full translation endpoint, such as `https://deeplx.example.com/translate`. Entering only a domain does not automatically add `/translate`. Leave it blank to use the default public endpoint.

In API Key, enter only the site's Token value, without a `Bearer` prefix. The Token is sent in the request header by default. If the site requires it in the URL, follow the site's instructions:


- Query parameter: `https://deeplx.example.com/translate?token={{apiKey}}`
- URL path: `https://deeplx.example.com/{{apiKey}}/translate`

Keep `{{apiKey}}` exactly as written. It is replaced with your saved API Key when sending, so you do not need to put the actual Token in the URL. A configured proxy URL takes priority; use the full path and the site's required Token format there too. Then click **Check connection**.

These settings apply only to the standalone DeepLX service. DeepLX in the free fallback service uses the default public anonymous endpoint.

## AI services

New configurations favor lightweight models for everyday translation:

| Service | Default model |
| --- | --- |
| DeepSeek | `deepseek-flash` (V4.1 Flash) |
| OpenAI | `gpt-5.4-mini` |
| Gemini | `gemini-3.5-flash-lite` |
| Qwen | `qwen3.8-flash` |
| Claude | `claude-haiku-4-5` |
| StepFun | `step-2-mini` |
| OpenRouter | `google/gemini-3.5-flash-lite` |

Catalog updates preserve your saved supported and custom models. Thinking is off by default for DeepSeek; models that cannot disable it use their lowest supported level. Larger models remain available for manual selection. Charges depend on the provider.

See the [DeepSeek changelog](https://api-docs.deepseek.com/updates/) for the new ID. The previous `deepseek-v4-flash` ID remains available as a compatibility alias. The retired Hunyuan `hy3-preview` is migrated to `hy3`.

Select a configured service and model. Use the custom-model option if yours is not listed. For a compatible third-party endpoint, add the address and model under your custom services.

For Azure, enter the actual deployment name as the model and your resource or complete API address as the endpoint.

Extra AI context can reference the page title and parts of the article to help with meaning. It sends more text and can increase usage and waiting time. Multi-paragraph translation groups nearby passages and may reduce request counts, but failures can still require retries. Both options are off by default and can be enabled independently.

Restore existing translations before translating with changed settings. Use [glossaries](/en/guide/glossary) for consistent terminology.

### Tencent Hunyuan connection failures

Select **Tencent Hunyuan** and enter an API key created in the Hunyuan console. The default uses the official Hunyuan endpoint. **Tencent Hunyuan Translate** is a separate service that requires a SecretId and SecretKey.

If an older version reports `Failed to fetch`, enter `https://api.hunyuan.cloud.tencent.com/v1/chat/completions` under **Advanced settings → Proxy URL**, then check the connection again. For a custom proxy or TokenHub, use the full endpoint and matching key provided by that platform.

See Tencent's [official integration guide](https://cloud.tencent.com/document/product/1729/116755) for endpoint and API key instructions.

## Local models

Install and run Ollama and download a model before connecting it. Performance depends on the model and computer.

Choosing a local model determines where that translation goes. Dictionary, read-aloud, downloads, and other independent tools can still use network services. See [Data & privacy](/en/guide/privacy).

## Connection failed?

Check the key, address, model, and provider balance. If short sentences work but long pages do not, reduce concurrency or try another service. Never include real credentials in feedback. See [Troubleshooting](/en/guide/faq).

You can also enable Tencent TranSmart, Yandex, and Volcengine in **Free translation settings**. These keyless web endpoints appear only as free translation candidates, not standalone services. They are disabled by default and preserve your existing order. Web endpoints may be rate-limited or unavailable. Yandex skips Traditional Chinese targets so the next candidate can handle them.

## Custom request headers

Select a custom OpenAI-compatible service under **My services**, then open **Advanced settings → Custom request headers**. Enter a JSON object with string values, for example:

```json
{"x-opencode-session": "a71a2ad6-1d1f-4e92-a30e-e35c8fd623ab"}
```

Headers apply only to this service and override matching defaults regardless of letter case. Leave blank to use defaults. A saved session ID stays the same across requests. Click **Check connection** after configuring it. Extra authentication headers, `HTTP-Referer`, and `X-Title` are supported. If your service uses custom authentication without a Bearer token, turn off the model's API Key requirement. Browser restrictions on headers still apply.

Headers are stored as credentials: public exports and history omit them, while full backups retain them. Re-enter them after changing the endpoint or proxy.

[OpenCode Go's documentation](https://opencode.ai/docs/go/#where-can-i-use-it) requires a stable session header and also specifies client and traffic requirements. Configurable headers do not imply certified compatibility with that service.
