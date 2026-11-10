# Article / lab

A browser-local, deterministic article learning workspace. No LLM, API keys, server, or agent SDK required.

## Run

```sh
npm install
npm run dev
```

Use **Try an example**, upload an article, or paste text. Supported files are UTF-8 `.txt`, `.md`, `.markdown`, `.html`, and `.htm`, up to 2 MB and at least 20 words. PDF, Word, OCR, and article URL retrieval are not implemented.

## Workflow

Logging starts before reading the file. The fixed sequence is upload → keyword extraction → context selection → counters → relevance summary → coverage summary → comparison/synopsis → concept dashboard → image lookup → recall game → self-check.

Each tool publishes a fresh state snapshot and trace entry. Tools validate outputs at runtime; the uploader validates input type, size, and content. Tools expose descriptions, input/output schemas, permissions, timeout/retry settings, and structured errors in **View tool contracts**. The synopsis text is included in the process log. Export downloads article state, process/error logs, checks, and contracts as JSON.

Both summaries use exact source passages, with sentence IDs visible throughout the interface. The first ranks keyword relevance; the second adds a reward for covering new keywords. The synopsis prefers passages selected by both, then consolidates coverage. Short articles may produce identical summaries. This is extractive text processing, not human-level semantic interpretation or factual verification. English-oriented stopwords and basic sentence splitting may perform poorly on other languages, abbreviations, and complex source formatting. Word count excludes Markdown image markup; HTML image count counts `<img>` elements in the selected article/main content. Markdown image counting handles basic inline syntax.

The dashboard links concepts to article passages. The game masks a keyword in a source passage and uses other article keywords as answer options. Completion checks source equality, synopsis provenance, counters, concept evidence, quiz answers, and the required tool trace. Failed checks remain visible; they never silently mark a run successful. Checks establish internal consistency, not the truth of article claims.

## Network, permissions, and recovery

Article processing stays in browser memory and resets on reload. Uploaded HTML is parsed in an inert document, scripts/styles/embedded content are removed, and only text and image counts enter state. Uploaded image URLs are never displayed. Article content cannot select tools or change routing. React renders article content as text.

The only application fetch is a Wikimedia Commons search using the top three keywords, after the synopsis. This lookup does not send article text. It accepts raster images with an allowed free license, HTTPS URLs on the expected Wikimedia hosts, and at least one matching keyword in title/description. Attribution and the source page are shown. Keyword relevance is heuristic; precise visual/semantic relevance cannot be guaranteed by these functions. No licensed match or a failed lookup produces a diagnostic and the workflow continues without an image. See the [official image metadata API](https://www.mediawiki.org/wiki/API:Imageinfo) for the lookup fields.

Image search gets 8 seconds per attempt and one retry. Local tools get a 5-second asynchronous deadline and no retries; synchronous JavaScript cannot be preempted by a timer, so file size is bounded. The workflow yields between stages to render progress and allow cancellation. Cancellation aborts requests and prevents downstream tools from running. New runs reset prior results, diagnostics, and game answers. There are no billable calls, publishing actions, or automatic external mutations requiring an approval step. Cancellation and recoverable failures are the explicit intervention paths.

## Deploy to Render

Push the `doc_sys` folder to a GitHub, GitLab, or Bitbucket repository, with
`render.yaml` at the repository root. In Render, choose **New → Blueprint**,
connect that repository, and deploy the `doc-sys-admin` static site.

For manual setup, choose **New → Static Site** and use:

| Setting | Value |
| --- | --- |
| Root Directory | `frontend/doc-sys-admin` |
| Build Command | `pnpm install --frozen-lockfile && pnpm run build` |
| Publish Directory | `dist` |
| Environment variable | `NODE_VERSION=24.20.0` |

No start command, backend, database, or API keys are required. If the repository
contains only the contents of `frontend/doc-sys-admin`, leave Root Directory
blank instead. The Blueprint assumes the full `doc_sys` directory structure.

See [Render static site documentation](https://render.com/docs/static-sites).

## Validation

```sh
npm test
npm run lint
npm run build
```

The Node test suite covers the full successful trace; ambiguous/partial source text; unsupported, empty, short, and oversized uploads; network failures and bounded retries; malicious instruction-like text; license/relevance/URL filtering; missing images; cancellation before and during work; timeouts; tampered outputs; immutable state; and all tool contract fields. Network responses are mocked for deterministic tests. HTML parser integration and visual layout still need browser review; the tests exercise the parser contract rather than a browser DOM.
