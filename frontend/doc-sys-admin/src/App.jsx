import { useEffect, useRef, useState } from 'react';
import { CONTRACTS, STEPS, runWorkflow } from './lib/workflow.mjs';
import { readLibrary, writeLibrary, upsertDocument } from './lib/library.mjs';
import './App.css';

const DEMO = `Urban forests and cooler cities
Trees help cities adapt to extreme heat. Urban forests provide shade and cool the air through evaporation from leaves. Shade reduces the sunlight absorbed by roads and buildings.
Urban trees also support biodiversity. Birds and insects use trees for food and shelter. A diverse urban forest is more resilient to pests than a forest dominated by one species.
Planting trees requires careful planning. Cities need to select species suited to local rainfall, soil, and available space. Young trees require watering and maintenance before they provide substantial shade.
Access to urban forests is not equal across neighborhoods. Communities with fewer trees often experience higher temperatures. Cities can prioritize tree planting in neighborhoods with limited shade to improve access to cooler public spaces.
Trees are one part of heat adaptation. Reflective roofs, shaded transit stops, and accessible cooling centers also help residents during heat waves. Tracking tree survival and neighborhood temperatures helps cities evaluate their investments.`;
function parseHtml(raw) {
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  doc.querySelectorAll('script, style, iframe, object, embed, template, noscript, nav, footer').forEach(el => el.remove());
  const article = doc.querySelector('article, main') || doc.body;
  const imageCount = article.querySelectorAll('img').length;
  article.querySelectorAll('p, h1, h2, h3, li, br, section, div').forEach(el => el.append('\n'));
  return { text: article.textContent, title: doc.title || article.querySelector('h1')?.textContent, imageCount };
}
function Evidence({ items = [] }) {
  return <div className="evidence">{items.map(item => <p key={item.id}><span className="source-id" title="Sentence reference in uploaded article">{item.id}</span>{item.text}</p>)}</div>;
}
function App() {
  const [state, setState] = useState(null);
  const [logs, setLogs] = useState([]);
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Ready to analyze');
  const [active, setActive] = useState('');
  const [slide, setSlide] = useState(0);
  const [answers, setAnswers] = useState({});
  const [contracts, setContracts] = useState(false);
  const [draft, setDraft] = useState('');
  const [view, setView] = useState('workspace');
  const [finished, setFinished] = useState(false);
  const [savedId, setSavedId] = useState(null);
  const [saveNotice, setSaveNotice] = useState('');
  const [library, setLibrary] = useState(() => {
    try { return { records: readLibrary(window.localStorage), error: '' }; }
    catch { return { records: [], error: 'Saved documents are unavailable. Check browser storage access and reload.' }; }
  });
  const controller = useRef(null);
  const runId = useRef(0);
  const logEnd = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { const container = logEnd.current?.parentElement; if (container) container.scrollTop = container.scrollHeight; }, [logs]);
  async function start(file) {
    controller.current?.abort();
    const id = ++runId.current;
    const abort = new AbortController(); controller.current = abort;
    setFinished(false); setSavedId(null); setSaveNotice(''); setView('workspace');
    setBusy(true); setState(null); setLogs([]); setErrors([]); setSlide(0); setAnswers({}); setStatus('Processing article');
    const append = event => {
      if (id !== runId.current) return;
      if (event.kind === 'state') setState(event.state);
      if (event.kind === 'process') { setLogs(items => [...items, { ...event, time: Date.now() }]); if (event.status === 'running') setActive(event.tool); }
      if (event.kind === 'error') setErrors(items => [...items, event]);
    };
    try {
      const result = await runWorkflow(file, { signal: abort.signal, parseHtml, onEvent: append });
      if (id === runId.current) {
        setFinished(true);
        setStatus(result.checks.every(c => c.passed) ? 'Complete · source checks passed' : 'Complete · review failed checks');
      }
    } catch (error) {
      if (id === runId.current) {
        setStatus(abort.signal.aborted ? 'Cancelled · partial results retained' : 'Processing stopped · review error log');
        setLogs(items => [...items, { tool: 'workflow', status: 'warning', time: Date.now(), message: abort.signal.aborted ? 'Cancelled by user.' : error.message }]);
      }
    } finally { if (id === runId.current) { setBusy(false); setActive(''); } }
  }
  const completed = state?.trace.filter(t => t.status === 'done' || t.status === 'warning').length || 0;
  const questions = state?.game || [];
  const score = questions.filter(q => answers[q.id] === q.answer).length;
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ state, logs, errors, contracts: CONTRACTS }, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'whuddup-doc-report.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function saveDocument() {
    if (!finished || busy || library.error) return;
    const record = { id: savedId || crypto.randomUUID(), savedAt: Date.now(), state, logs, errors, answers };
    try {
      const records = upsertDocument(library.records, record);
      writeLibrary(window.localStorage, records);
      setLibrary({ records, error: '' }); setSavedId(record.id);
      setSaveNotice('Document saved.');
    } catch {
      setSaveNotice('Could not save. Browser storage may be full or unavailable. Export your report to keep a copy.');
    }
  }
  function openDocument(record) {
    if (busy) return;
    setState(record.state); setLogs(record.logs); setErrors(record.errors);
    setAnswers(record.answers || {}); setSlide(0); setContracts(false);
    setSavedId(record.id); setFinished(true); setSaveNotice('');
    setStatus(record.state.checks.every(check => check.passed) ? 'Saved document · source checks passed' : 'Saved document · review failed checks');
    setView('workspace');
  }
  function removeDocument(id) {
    try {
      const records = library.records.filter(record => record.id !== id);
      writeLibrary(window.localStorage, records);
      setLibrary({ records, error: '' });
      if (savedId === id) setSavedId(null);
      setSaveNotice('Document removed from saved documents.');
    } catch { setSaveNotice('Could not remove this document. Check browser storage access and try again.'); }
  }
  return <>
    <header className="app-header">
      <a className="app-brand" href="#workspace" onClick={() => setView('workspace')}><img src="/favicon.svg" width="34" height="34" alt="" /><h1>Whuddup_Doc</h1></a>
      <nav className="workspace-nav" aria-label="Application views">
        <button aria-pressed={view === 'workspace'} onClick={() => setView('workspace')}>Workspace</button>
        <button aria-pressed={view === 'saved'} onClick={() => { setView('saved'); setSaveNotice(''); }}>Saved documents <span>{library.records.length}</span></button>
      </nav>
    </header>
    {view === 'saved' && <main className="saved-library" aria-labelledby="saved-heading">
      <div className="library-heading"><div><h2 id="saved-heading">Saved documents</h2><p className="muted">Saved in this browser. Includes source text, summaries, concepts, and recall progress.</p></div><button className="secondary" onClick={() => setView('workspace')}>Back to workspace</button></div>
      <section className="save-current" aria-label="Save current document"><div><h3>{finished ? state.article.title : 'Save your next read'}</h3><p className="muted">{finished ? 'Keep this document and its completed analysis.' : 'Finish analyzing an article in the workspace to save it here.'}</p></div><button className="primary-button" disabled={!finished || busy || !!library.error} onClick={saveDocument}>{savedId ? 'Update saved document' : 'Save document'}</button></section>
      {(saveNotice || library.error) && <p className="save-notice" role="status">{library.error || saveNotice}</p>}
      {library.records.length ? <div className="saved-list">{library.records.map(record => <article className="saved-document" key={record.id}><div className="saved-document-info"><h3>{record.state.article.title}</h3><p className="muted">{record.state.counters.words.toLocaleString()} words · {record.state.keywords.length} keywords · {record.state.checks.every(check => check.passed) ? 'Checks passed' : 'Review checks'}</p><time dateTime={new Date(record.savedAt).toISOString()}>Saved {new Date(record.savedAt).toLocaleString()}</time></div><div className="saved-actions"><button className="secondary" disabled={busy} onClick={() => openDocument(record)}>Open</button><button className="text-button remove-document" aria-label={`Remove ${record.state.article.title} from saved documents`} onClick={() => removeDocument(record.id)}>Remove</button></div></article>)}</div> : !library.error && <div className="library-empty"><span aria-hidden="true">▤</span><h3>No saved documents yet</h3><p>Analyze an article, then save it to return to it later.</p></div>}
      <p className="library-footnote">Saved documents remain on this device until removed or browser data is cleared. Export a report for a portable copy.</p>
    </main>}
    <div className="sysMaster" id="workspace" hidden={view !== 'workspace'}>
      <aside className="processLogger panel"><div className="panel-heading"><h2><span className="live-dot" />Activity</h2></div><div className="log-scroll" role="log" aria-label="Process log" aria-live="polite">{!logs.length && <div className="log-empty"><p>Activity appears when you add an article.</p></div>}{logs.map((log, i) => <div className={`log-entry ${log.status}`} key={i}><div><span>{new Date(log.time).toLocaleTimeString()}</span><b>{log.status === 'done' ? '✓' : log.status === 'warning' ? '!' : '→'} {log.tool}</b></div><p>{log.message}</p></div>)}<div ref={logEnd} /></div><div className="trace-footer">{completed} / {STEPS.length} steps complete</div></aside>
      <main className="contentHub">
        {/* Original starter: uploader, article name, and counter holster. */}
        <div className="starterComponent">
          <label className={`articleUploader ${busy ? 'disabled' : ''}`} title="Upload an article">↑<input aria-label="Upload an article" type="file" accept=".txt,.md,.markdown,.html,.htm" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) start(file); e.target.value = ''; }} /></label>
          <h2 className="article-title">{state?.article?.title || 'Article workspace'}</h2>
          <div className="counterHolster">{[['Words', state?.counters?.words], ['Images', state?.counters?.images], ['Statements', state?.counters?.sentences], ['Keywords', state?.keywords?.length]].map(([label, value]) => <div key={label}><strong>{value ?? '—'}</strong><span>{label}</span></div>)}</div>
        </div>
        <div className="sourceControls">
          <p>.txt, .md, .html · Up to 2 MB</p>
          <p className="status" role="status">{status}</p>
          <div className="upload-actions"><button className="text-button" disabled={busy} onClick={() => start(new File([DEMO], 'Urban forests and cooler cities.txt', { type: 'text/plain' }))}>Try an example ↗</button>{finished && <button className="secondary" onClick={() => { setView('saved'); setSaveNotice(''); }}>Save document</button>}{busy && <button className="secondary" onClick={() => controller.current?.abort()}>Cancel</button>}</div><details className="paste-area"><summary>Paste text</summary><label htmlFor="article-text">Article text</label><textarea id="article-text" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Paste at least 20 words…" /><button className="secondary" disabled={busy || !draft.trim()} onClick={() => start(new File([draft], 'Pasted article.txt', { type: 'text/plain' }))}>Analyze text</button></details>
          <div className="progress-track" role="progressbar" aria-label="Workflow progress" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={STEPS.length}><div style={{ width: `${completed / STEPS.length * 100}%` }} /></div>
          {busy && <p className="active-tool">Running: {active}</p>}
        </div>
        <div className="contextComponent"><section className="contextLeft panel"><div className="section-label">Discover</div><h2>Keywords</h2><p className="muted">Most frequent terms</p><div className="keywords">{state?.keywords.map((k, i) => <div className="keyword" key={k.word}><span className="keyword-number">{String(i + 1).padStart(2, '0')}</span><b>{k.word}</b><span className="keyword-count">{k.count}×</span></div>) || <p className="placeholder">Add an article to see its key terms.</p>}</div></section><div className="contextRight"><section className="contextblock panel"><div className="section-label">Understand</div><h2>Context</h2><p className="muted">Key passages from your article</p>{state?.context.length ? <Evidence items={state.context} /> : <p className="placeholder">Selected passages appear here.</p>}</section><section className="summaryblock panel"><div className="section-label">Synthesize <span>{state?.summaries.length || 0} / 2</span></div><h2>Summary</h2><div className="tabs" role="group" aria-label="Summary carousel">{['Relevance', 'Coverage', 'Synopsis'].map((label, i) => <button key={label} aria-pressed={slide === i} onClick={() => setSlide(i)}>{label}</button>)}</div><p className="muted">{slide === 2 ? `${state?.synopsis?.shared.length ?? 0} passages shared by both summaries.` : 'Original passages, in source order'}</p>{(slide === 2 ? state?.synopsis?.statements : state?.summaries[slide])?.length ? <Evidence items={slide === 2 ? state.synopsis.statements : state.summaries[slide]} /> : <p className="placeholder">Your summary appears after analysis.</p>}<div className="carousel-controls"><button className="text-button" aria-label="Previous summary" onClick={() => setSlide((slide + 2) % 3)}>←</button><span>{slide + 1} / 3</span><button className="text-button" aria-label="Next summary" onClick={() => setSlide((slide + 1) % 3)}>→</button></div><p className="method-note">Summaries use original passages. Source checks confirm attribution, not factual accuracy.</p></section></div></div>
        <hr />
        <section className="majorRetain panel"><div className="section-label">Connect</div><h2>Explore concepts</h2><div className="splitter"><div className="imageTrained">{state?.image ? <figure><img className="imgRes" src={state.image.url} alt={state.image.title} referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; setErrors(items => items.some(item => item.code === 'IMAGE_LOAD') ? items : [...items, { tool: 'image', code: 'IMAGE_LOAD', message: 'The selected image could not be displayed. Use its source link.', time: Date.now() }]); }} /><figcaption><a href={state.image.source} target="_blank" rel="noreferrer">{state.image.title} ↗</a><p>{state.image.artist} · {state.image.license}</p><p>Matching terms: {state.image.matching.join(', ')}. Match based on keywords.</p></figcaption></figure> : <div className="image-placeholder"><span>▧</span><b>Related image</b><p>{completed >= 9 ? 'No matching image available.' : 'Images matched to your key terms.'}</p></div>}</div><div className="dashboardCanopy"><h2>Concepts</h2>{state?.dashboard.length ? state.dashboard.map(c => <details key={c.word} className="concept"><summary>{c.word}<span>{c.count} mentions ↗</span></summary><Evidence items={c.evidence} /></details>) : <p className="placeholder">Concepts and supporting passages appear here.</p>}</div></div></section>
        <hr />
        <section className="game panel"><div className="section-label">Remember <span>{Object.keys(answers).length} / {questions.length || '—'} ANSWERED</span></div><h2>Quick recall</h2><p className="muted">Complete the missing term in each passage.</p>{questions.length ? <><div className="game-score">{score} / {questions.length} correct<button className="text-button" onClick={() => setAnswers({})}>Start again ↻</button></div>{questions.map((q, i) => <div className="question" key={q.id}><span className="micro">QUESTION {i + 1}</span><p>{q.prompt}</p><div className="options">{q.options.map(option => <button key={option} disabled={!!answers[q.id]} className={answers[q.id] ? option === q.answer ? 'correct' : answers[q.id] === option ? 'incorrect' : '' : ''} onClick={() => setAnswers(previous => ({ ...previous, [q.id]: option }))}>{option}</button>)}</div>{answers[q.id] && <div className="feedback" role="status">{answers[q.id] === q.answer ? 'Correct.' : `The answer is “${q.answer}”.`} <Evidence items={[q.evidence]} /></div>}</div>)}</> : <p className="placeholder">Questions appear after analysis.</p>}</section>
        {state?.checks.length > 0 && <section className="panel checks"><div className="section-label">Review</div><h2>Source checks</h2>{state.checks.map(check => <p key={check.name} className={check.passed ? 'passed' : 'failed'}>{check.passed ? '✓' : '!'} {check.name}</p>)}</section>}
        {state?.article && <details className="panel source-preview"><summary>View source passages</summary><Evidence items={state.article.sentences} /></details>}
        <button className="secondary contracts-toggle" onClick={() => setContracts(!contracts)}>{contracts ? 'Hide' : 'View'} technical details</button>
    {contracts && <section className="panel contracts"><h2>Technical details</h2><p>Fixed routing: every step follows the same sequence. No model calls. Source content is data and cannot change the workflow. Only image search makes network requests.</p>{Object.values(CONTRACTS).map(c => <details key={c.name}><summary>{c.name} — {c.description}</summary><dl>{Object.entries(c).filter(([key]) => !['name', 'description'].includes(key)).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl></details>)}</section>}
        <footer className="workspace-footer"><span>Processed in your browser</span><button className="text-button" disabled={!logs.length} onClick={download}>Export report ↓</button></footer>
      </main>
      <aside className="errorLogger panel"><div className="panel-heading"><h2>Diagnostics</h2><span className={`error-count ${errors.length ? 'has-errors' : ''}`}>{errors.length}</span></div><div role="log" aria-label="Error log" aria-live="polite">{!errors.length ? <div className="healthy"><span>✓</span><b>All clear</b><p>Issues will appear here if they occur.</p></div> : errors.map((error, i) => <div className="error-entry" key={i}><span>{new Date(error.time).toLocaleTimeString()} · {error.tool}</span><b>{error.code}</b><p>{error.message}</p>{error.attempt && <small>Attempt {error.attempt}</small>}</div>)}</div><div className="boundaries"><span className="micro">PRIVACY</span><p>Your article stays in this browser.</p><p>Image search shares only three keywords.</p></div></aside>
  </div>
  </>;
}
export default App;
