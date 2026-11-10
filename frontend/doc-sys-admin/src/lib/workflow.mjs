const STOP = new Set('a an the and or but is are was were be been being to of in on for with as at by from that this these those it its they their we our you your can could would should will may might has have had not into through more most also than such each once article about'.split(' '));
export const MAX_BYTES = 2 * 1024 * 1024;
export const STEPS = ['upload', 'keywords', 'context', 'counters', 'summaryOne', 'summaryTwo', 'synopsis', 'dashboard', 'image', 'game', 'verify'];
const descriptions = ['Read and validate a local text, Markdown, or HTML article', 'Rank recurring meaningful words', 'Extract source statements with sentence references', 'Count source words and images', 'Select a relevance-ranked source summary', 'Select an independent coverage-ranked source summary', 'Compare summaries and consolidate supported passages', 'Map concepts to source statements', 'Find an openly licensed related image', 'Build a source-backed recall activity', 'Check source grounding, state consistency, and tool trace'];
export const CONTRACTS = Object.fromEntries(STEPS.map((name, i) => [name, {
  name, description: descriptions[i], inputSchema: name === 'upload' ? '{ file: File, size: 1..2097152 bytes, extension: txt|md|markdown|html|htm }' : '{ article: Article, ...completedDependencies }',
  outputSchema: ({ upload: 'Article { title, text, sentences[{ id, text }], imageCount }', keywords: 'Keyword[{ word, count }]', context: 'Statement[{ id, text }]', counters: '{ words, images, sentences }', summaryOne: 'Statement[]', summaryTwo: 'Statement[]', synopsis: '{ shared: string[], statements: Statement[] }', dashboard: 'Concept[{ word, count, evidence: Statement[] }]', image: 'LicensedImage | null', game: 'Question[{ id, prompt, answer, options, evidence }]', verify: 'Check[{ name, passed }]' })[name],
  permissionBoundaries: name === 'image' ? 'GET https://commons.wikimedia.org only; send top three keywords; no article body' : 'Local memory only; uploaded HTML is parsed inertly and never executed',
  timeoutMs: name === 'image' ? 8000 : 5000, retries: name === 'image' ? 1 : 0,
  errorFormat: '{ tool, code, message, attempt, time }',
}]));
export const words = text => text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || [];
export function parseArticle(raw, name, type = 'text', parseHtml) {
  let text = raw, imageCount = 0, title = name.replace(/\.[^.]+$/, '');
  if (type === 'html') {
    if (!parseHtml) throw new Error('HTML parser unavailable');
    const parsed = parseHtml(raw);
    text = parsed.text; title = parsed.title || title; imageCount = parsed.imageCount;
  } else {
    imageCount = (raw.match(/!\[[^\]]*\]\([^\n)]*\)/g) || []).length;
    text = raw.replace(/!\[[^\]]*\]\([^\n)]*\)/g, ' ').replace(/^#{1,6}\s+/gm, '');
  }
  text = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  if (words(text).length < 20) throw new Error('Please provide at least 20 words of readable article text.');
  const sentences = (text.match(/[^.!?\n]+(?:[.!?]+[”"’']*|$)/gu) || []).map(s => s.trim()).filter(s => words(s).length >= 4).map((text, i) => ({ id: `S${i + 1}`, text }));
  if (!sentences.length) throw new Error('No usable source statements found.');
  return { title, text, sentences, imageCount };
}
export function extractKeywords(article) {
  const counts = new Map();
  for (const word of words(article.text)) if (word.length > 2 && !STOP.has(word) && !/^\d+$/.test(word)) counts.set(word, (counts.get(word) || 0) + 1);
  return [...counts].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)).slice(0, 12);
}
function score(sentence, keywords) {
  const tokens = new Set(words(sentence.text));
  return keywords.reduce((sum, k) => sum + (tokens.has(k.word) ? k.count : 0), 0) / Math.sqrt(Math.max(tokens.size, 1));
}
export function summarize(article, keywords, coverage = false) {
  let candidates = [...article.sentences], chosen = [], seen = new Set();
  while (chosen.length < Math.min(5, article.sentences.length) && candidates.length) {
    candidates.sort((a, b) => {
      const rank = s => score(s, keywords) + (coverage ? keywords.filter(k => !seen.has(k.word) && words(s.text).includes(k.word)).length * 3 : 0);
      return rank(b) - rank(a) || Number(a.id.slice(1)) - Number(b.id.slice(1));
    });
    const selected = candidates.shift(); chosen.push(selected); words(selected.text).forEach(w => seen.add(w));
  }
  return chosen.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}
export function buildGame(article, keywords) {
  return keywords.flatMap(k => {
    const evidence = article.sentences.find(s => words(s.text).includes(k.word));
    if (!evidence) return [];
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${k.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu');
    const options = [k.word, ...keywords.filter(other => other.word !== k.word).slice(0, 3).map(other => other.word)].sort();
    return options.length >= 2 ? [{ id: k.word, prompt: evidence.text.replace(pattern, '______'), answer: k.word, options, evidence }] : [];
  }).slice(0, 5);
}
const plain = value => String(value || '').replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();
const safeUrl = (value, host) => { try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === host; } catch { return false; } };
export async function findImage(keywords, signal, fetcher = fetch) {
  if (!keywords.length) return null;
  const query = keywords.slice(0, 3).map(k => k.word).join(' ');
  const params = new URLSearchParams({ action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: query, gsrnamespace: '6', gsrlimit: '5', prop: 'imageinfo', iiprop: 'url|extmetadata|mime', iiurlwidth: '800' });
  const response = await fetcher(`https://commons.wikimedia.org/w/api.php?${params}`, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(`Image search returned HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.info || 'Image search API error');
  for (const page of Object.values(data.query?.pages || {})) {
    const info = page.imageinfo?.[0], meta = info?.extmetadata;
    const license = plain(meta?.LicenseShortName?.value);
    const description = plain(meta?.ImageDescription?.value);
    const matching = keywords.slice(0, 3).filter(k => words(`${page.title} ${description}`).includes(k.word));
    if (!info || !/^image\/(jpeg|png|webp)$/.test(info.mime) || !/^(CC0|Public domain|CC BY(?:-SA)? [\d.]+)$/i.test(license) || !matching.length || !safeUrl(info.thumburl || info.url, 'upload.wikimedia.org') || !safeUrl(info.descriptionurl, 'commons.wikimedia.org')) continue;
    return { url: info.thumburl || info.url, source: info.descriptionurl, title: plain(page.title).replace(/^File:/, ''), description, license, artist: plain(meta?.Artist?.value) || 'See source for creator', query, matching: matching.map(k => k.word) };
  }
  return null;
}
export function verify(state) {
  const source = new Map(state.article.sentences.map(s => [s.id, s.text]));
  const grounded = items => items.every(s => source.get(s.id) === s.text);
  return [
    { name: 'Context and both summaries match source passages', passed: [state.context, ...state.summaries].every(items => items.length > 0 && grounded(items)) },
    { name: 'Synopsis contains only compared summary evidence', passed: state.synopsis.statements.length > 0 && grounded(state.synopsis.statements) && state.synopsis.statements.every(s => state.summaries.some(summary => summary.some(item => item.id === s.id))) },
    { name: 'Counters match the uploaded article', passed: state.counters.words === words(state.article.text).length && state.counters.images === state.article.imageCount },
    { name: 'Dashboard concepts have source evidence', passed: state.dashboard.length > 0 && state.dashboard.every(c => c.evidence.length > 0 && grounded(c.evidence) && c.evidence.every(s => words(s.text).includes(c.word))) },
    { name: 'Recall answers are supported by the article', passed: state.game.length > 0 && state.game.every(q => source.get(q.evidence.id) === q.evidence.text && words(q.evidence.text).includes(q.answer) && q.options.includes(q.answer)) },
    { name: 'Every required processing step completed', passed: STEPS.filter(s => !['image', 'verify'].includes(s)).every(s => state.trace.some(t => t.tool === s && t.status === 'done')) },
    { name: 'Image lookup completed or recorded a recoverable warning', passed: state.trace.some(t => t.tool === 'image' && ['done', 'warning'].includes(t.status)) },
  ];
}
function validateOutput(name, result) {
  const statements = items => Array.isArray(items) && items.length > 0 && items.every(s => typeof s.id === 'string' && typeof s.text === 'string');
  const valid = {
    upload: () => result && typeof result.text === 'string' && statements(result.sentences),
    keywords: () => Array.isArray(result) && result.every(k => typeof k.word === 'string' && Number.isInteger(k.count)),
    context: () => statements(result), summaryOne: () => statements(result), summaryTwo: () => statements(result),
    counters: () => result && ['words', 'images', 'sentences'].every(k => Number.isInteger(result[k]) && result[k] >= 0),
    synopsis: () => result && Array.isArray(result.shared) && statements(result.statements),
    dashboard: () => Array.isArray(result) && result.every(c => typeof c.word === 'string' && statements(c.evidence)),
    image: () => result === null || (result && safeUrl(result.url, 'upload.wikimedia.org') && safeUrl(result.source, 'commons.wikimedia.org') && typeof result.license === 'string'),
    game: () => Array.isArray(result) && result.every(q => typeof q.prompt === 'string' && q.options.includes(q.answer) && statements([q.evidence])),
    verify: () => Array.isArray(result) && result.length > 0 && result.every(c => typeof c.name === 'string' && typeof c.passed === 'boolean'),
  };
  if (!valid[name]?.()) throw new Error(`${name} returned an invalid output schema`);
}
function abortError() { return new DOMException('Workflow cancelled', 'AbortError'); }
export async function runWorkflow(file, { onEvent, signal, parseHtml, fetcher = fetch }) {
  let state = { article: null, keywords: [], context: [], counters: null, summaries: [], synopsis: null, dashboard: [], image: null, game: [], checks: [], trace: [] };
  const emit = (kind, value) => onEvent({ kind, ...value });
  async function tool(name, action, apply) {
    const contract = CONTRACTS[name];
    for (let attempt = 0; attempt <= contract.retries; attempt++) {
      if (signal?.aborted) throw abortError();
      if (name !== 'upload' && !state.article) throw new Error(`${name} requires a validated article`);
      emit('process', { tool: name, status: 'running', message: `${contract.description}${attempt ? ' (retry)' : ''}` });
      // Yield between synchronous functions so React can paint live state and accept cancellation.
      await new Promise(resolve => setTimeout(resolve, 20));
      if (signal?.aborted) throw abortError();
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      let timer, abortListener;
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => action(controller.signal)),
          new Promise((_, reject) => {
            abortListener = () => reject(signal?.aborted ? abortError() : new Error(`${name} exceeded ${contract.timeoutMs}ms`));
            controller.signal.addEventListener('abort', abortListener, { once: true });
            timer = setTimeout(() => controller.abort(), contract.timeoutMs);
          }),
        ]);
        if (signal?.aborted) throw abortError();
        validateOutput(name, result);
        state = { ...state, ...apply(result), trace: [...state.trace, { tool: name, status: 'done', attempt, time: Date.now() }] };
        emit('state', { state });
        emit('process', { tool: name, status: 'done', message: name === 'synopsis' ? `Synopsis: ${state.synopsis.statements.map(s => s.text).join(' ')}` : `${name} completed` });
        return;
      } catch (error) {
        if (signal?.aborted) throw abortError();
        emit('error', { tool: name, code: controller.signal.aborted ? 'TIMEOUT' : 'TOOL_FAILED', message: error.message, attempt: attempt + 1, time: Date.now() });
        if (attempt === contract.retries) {
          if (name !== 'image') throw error;
          state = { ...state, trace: [...state.trace, { tool: name, status: 'warning', time: Date.now() }] };
          emit('state', { state }); emit('process', { tool: name, status: 'warning', message: 'Image search unavailable. Continuing with source-backed concepts.' });
        }
      } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', cancel);
        if (abortListener) controller.signal.removeEventListener('abort', abortListener);
      }
    }
  }
  emit('process', { tool: 'workflow', status: 'running', message: 'Process and error tracking started before upload.' });
  await tool('upload', async () => {
    if (!file || file.size <= 0 || file.size > MAX_BYTES) throw new Error('Choose a nonempty article under 2 MB.');
    if (!/\.(txt|md|markdown|html|htm)$/i.test(file.name)) throw new Error('Supported formats: .txt, .md, .markdown, .html, .htm. PDF and Word require a separate parser.');
    return parseArticle(await file.text(), file.name, /\.html?$/i.test(file.name) ? 'html' : 'text', parseHtml);
  }, article => ({ article }));
  await tool('keywords', () => extractKeywords(state.article), keywords => ({ keywords }));
  await tool('context', () => summarize(state.article, state.keywords, true).slice(0, 4), context => ({ context }));
  await tool('counters', () => ({ words: words(state.article.text).length, images: state.article.imageCount, sentences: state.article.sentences.length }), counters => ({ counters }));
  await tool('summaryOne', () => summarize(state.article, state.keywords), summary => ({ summaries: [summary] }));
  await tool('summaryTwo', () => summarize(state.article, state.keywords, true), summary => ({ summaries: [...state.summaries, summary] }));
  await tool('synopsis', () => {
    const shared = state.summaries[0].filter(s => state.summaries[1].some(t => t.id === s.id)).map(s => s.id);
    const union = [...new Map(state.summaries.flat().map(s => [s.id, s])).values()];
    union.sort((a, b) => Number(shared.includes(b.id)) - Number(shared.includes(a.id)) || score(b, state.keywords) - score(a, state.keywords));
    return { shared, statements: union.slice(0, 4).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))) };
  }, synopsis => ({ synopsis }));
  await tool('dashboard', () => state.keywords.slice(0, 6).map(k => ({ ...k, evidence: state.article.sentences.filter(s => words(s.text).includes(k.word)).slice(0, 2) })), dashboard => ({ dashboard }));
  await tool('image', sig => findImage(state.keywords, sig, fetcher), image => {
    if (!image) emit('error', { tool: 'image', code: 'NO_MATCH', message: 'No licensed image passed the keyword relevance filter. No image substituted.', attempt: 1, time: Date.now() });
    return { image };
  });
  await tool('game', () => buildGame(state.article, state.keywords), game => ({ game }));
  await tool('verify', () => verify(state), checks => ({ checks }));
  const failed = state.checks.filter(c => !c.passed);
  if (failed.length) {
    emit('error', { tool: 'verify', code: 'CHECK_FAILED', message: failed.map(c => c.name).join('; '), attempt: 1, time: Date.now() });
    emit('process', { tool: 'workflow', status: 'warning', message: 'Workflow finished with failed checks. Review results.' });
  } else emit('process', { tool: 'workflow', status: 'done', message: 'Workflow complete. All source and trace checks passed.' });
  return state;
}
