# Local Web Research

Vault Assistant can give Claude Code and every supported CLI agent the same
bounded web-research capability without a paid API. It is off by default.

## What runs locally

- **SearXNG** supplies search results through its JSON API.
- **Mozilla Readability** extracts the main text from ordinary web pages.
- **Playwright Chromium** is a local fallback for JavaScript-rendered pages.

The agent never receives browser, shell, or direct network access. Instead, it
can return one text-only `web_search` or `web_read` request. The app validates
the request, runs it, labels the result as untrusted data, and returns it to the
agent. A request is limited to four operations per answer.

## One-time setup

Install the local Chromium fallback once after installing the project dependencies:

```bash
bunx playwright install chromium
```

Run SearXNG on loopback. The example below uses its free container image and
keeps it unreachable from other machines:

```bash
docker run --rm --name vault-searxng -p 127.0.0.1:8080:8080 searxng/searxng:latest
```

SearXNG's JSON format must be enabled in its `settings.yml`:

```yaml
search:
  formats:
    - html
    - json
```

Then open **Settings → Retrieval**, enable **Local web research**, and set the
Local SearXNG URL to `http://127.0.0.1:8080`.

## Resolver modes

| Mode | Behavior |
| --- | --- |
| Readability | Fetches HTML and extracts the main article locally. Fastest option. |
| Auto | Uses Readability, then local Chromium only when the extracted page is sparse. |
| Chromium | Uses local Chromium for every URL. Use this for JavaScript-heavy sites. |

All URL reads allow only public `http`/`https` pages on standard ports. Redirect
destinations are revalidated, private/loopback DNS answers are rejected, response
bodies are capped at 2 MB, and extracted text is capped before entering a prompt.
These application checks reduce SSRF exposure; run the app with ordinary host or
container network isolation as a second boundary.

## Limitations

SearXNG aggregates upstream engines, so result quality and availability depend
on the engines enabled in its configuration. Some sites block automated browsers
or require a login; the resolver does not bypass those controls.
