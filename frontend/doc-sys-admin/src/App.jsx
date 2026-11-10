import { useEffect, useRef, useState } from 'react';
import { CONTRACTS, STEPS, runWorkflow } from './lib/workflow.mjs';
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
  const [status, setStatus] = useState('Ready for an article');
  const [active, setActive] = useState('');
  const [slide, setSlide] = useState(0);
  const [answers, setAnswers] = useState({});
  const [contracts, setContracts] = useState(false);
  const [draft, setDraft] = useState('');
  const controller = useRef(null);
  const runId = useRef(0);
  const logEnd = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { const container = logEnd.current?.parentElement; if (container) container.scrollTop = container.scrollHeight; }, [logs]);
  async function start(file) {
    controller.current?.abort();
    const id = ++runId.current;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setState(null); setLogs([]); setErrors([]); setSlide(0); setAnswers({}); setStatus('Processing article');
    const append = event => {
      if (id !== runId.current) return;
      if (event.kind === 'state') setState(event.state);
      if (event.kind === 'process') { setLogs(items => [...items, { ...event, time: Date.now() }]); if (event.status === 'running') setActive(event.tool); }
      if (event.kind === 'error') setErrors(items => [...items, event]);
    };
    try {
      const result = await runWorkflow(file, { signal: abort.signal, parseHtml, onEvent: append });
      if (id === runId.current) setStatus(result.checks.every(c => c.passed) ? 'Complete · source checks passed' : 'Complete · review failed checks');
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
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'article-workflow-report.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="sysMaster">
      <aside className="processLogger panel"><div className="panel-heading"><h2><span className="live-dot" />Process Logs</h2><span className="micro">LIVE TRACE</span></div><div className="log-scroll" role="log" aria-label="Process log" aria-live="polite">{!logs.length && <div className="log-empty"><span>01 / WAITING</span><p>Every function leaves a trail.<br />Your workflow starts here.</p></div>}{logs.map((log, i) => <div className={`log-entry ${log.status}`} key={i}><div><span>{new Date(log.time).toLocaleTimeString()}</span><b>{log.status === 'done' ? '✓' : log.status === 'warning' ? '!' : '→'} {log.tool}</b></div><p>{log.message}</p></div>)}<div ref={logEnd} /></div><div className="trace-footer">{completed} / {STEPS.length} tools completed</div></aside>
      <main className="contentHub">
        {/* Original starter: uploader, article name, and counter holster. */}
        <div className="starterComponent">
          <label className={`articleUploader ${busy ? 'disabled' : ''}`} title="Upload an article">↑<input aria-label="Upload an article" type="file" accept=".txt,.md,.markdown,.html,.htm" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) start(file); e.target.value = ''; }} /></label>
          <h1>{state?.article?.title || 'Article Name'}</h1>
          <div className="counterHolster">{[['Words', state?.counters?.words], ['Source images', state?.counters?.images], ['Statements', state?.counters?.sentences], ['Keywords', state?.keywords?.length]].map(([label, value]) => <div key={label}><strong>{value ?? '—'}</strong><span>{label}</span></div>)}</div>
        </div>
        <div className="sourceControls">
          <p>Upload .txt, .md, or .html · maximum 2 MB</p>
          <p className="status" role="status">{status}</p>
          <div className="upload-actions"><button className="text-button" disabled={busy} onClick={() => start(new File([DEMO], 'Urban forests and cooler cities.txt', { type: 'text/plain' }))}>Try an example ↗</button>{busy && <button className="secondary" onClick={() => controller.current?.abort()}>Cancel</button>}</div><details className="paste-area"><summary>Or paste article text</summary><label htmlFor="article-text">Article text</label><textarea id="article-text" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Paste at least 20 words…" /><button className="secondary" disabled={busy || !draft.trim()} onClick={() => start(new File([draft], 'Pasted article.txt', { type: 'text/plain' }))}>Analyze text</button></details>
          <div className="progress-track" role="progressbar" aria-label="Workflow progress" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={STEPS.length}><div style={{ width: `${completed / STEPS.length * 100}%` }} /></div>
          {busy && <p className="active-tool">Running: {active}</p>}
        </div>
        <div className="contextComponent"><section className="contextLeft panel"><div className="section-label">02 / DISCOVER</div><h2>Keywords</h2><p className="muted">Ranked by source frequency</p><div className="keywords">{state?.keywords.map((k, i) => <div className="keyword" key={k.word}><span className="keyword-number">{String(i + 1).padStart(2, '0')}</span><b>{k.word}</b><span className="keyword-count">{k.count}×</span></div>) || <p className="placeholder">The recurring ideas in your article will appear here.</p>}</div></section><div className="contextRight"><section className="contextblock panel"><div className="section-label">03 / UNDERSTAND</div><h2>Context</h2><p className="muted">Source statements selected for concept coverage</p>{state?.context.length ? <Evidence items={state.context} /> : <p className="placeholder">Article evidence becomes the shared context for every step.</p>}</section><section className="summaryblock panel"><div className="section-label">04 / SYNTHESIZE <span>{state?.summaries.length || 0} / 2 PASSES</span></div><h2>Summary</h2><div className="tabs" role="group" aria-label="Summary carousel">{['Relevance pass', 'Coverage pass', 'Final synopsis'].map((label, i) => <button key={label} aria-pressed={slide === i} onClick={() => setSlide(i)}>{label}</button>)}</div><p className="muted">{slide === 2 ? `${state?.synopsis?.shared.length ?? 0} passages selected by both passes. Synopsis combines their strongest evidence.` : 'Extractive summary · exact article passages, in source order'}</p>{(slide === 2 ? state?.synopsis?.statements : state?.summaries[slide])?.length ? <Evidence items={slide === 2 ? state.synopsis.statements : state.summaries[slide]} /> : <p className="placeholder">This view fills when its processing step finishes.</p>}<div className="carousel-controls"><button className="text-button" aria-label="Previous summary" onClick={() => setSlide((slide + 2) % 3)}>←</button><span>{slide + 1} / 3</span><button className="text-button" aria-label="Next summary" onClick={() => setSlide((slide + 1) % 3)}>→</button></div><p className="method-note">Two deterministic selection strategies check coverage. Source checks verify provenance; they do not verify the article’s factual accuracy.</p></section></div></div>
        <hr />
        <section className="majorRetain panel"><div className="section-label">05 / CONNECT</div><h2>Article retention</h2><p className="muted">Explore the concepts and the evidence behind them.</p><div className="splitter"><div className="imageTrained">{state?.image ? <figure><img className="imgRes" src={state.image.url} alt={state.image.title} referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; setErrors(items => items.some(item => item.code === 'IMAGE_LOAD') ? items : [...items, { tool: 'image', code: 'IMAGE_LOAD', message: 'The selected image could not be displayed. Use its source link.', time: Date.now() }]); }} /><figcaption><a href={state.image.source} target="_blank" rel="noreferrer">{state.image.title} ↗</a><p>{state.image.artist} · {state.image.license}</p><p>Keyword match: {state.image.matching.join(', ')}. Relevance is heuristic.</p></figcaption></figure> : <div className="image-placeholder"><span>▧</span><b>A visual connection</b><p>{completed >= 9 ? 'No suitable image available. See the error log for details.' : 'A free image will be searched using your article’s top keywords.'}</p></div>}</div><div className="dashboardCanopy"><h2>Dashboard</h2>{state?.dashboard.length ? state.dashboard.map(c => <details key={c.word} className="concept"><summary>{c.word}<span>{c.count} mentions ↗</span></summary><Evidence items={c.evidence} /></details>) : <p className="placeholder">Your concept map will grow here.</p>}</div></div></section>
        <hr />
        <section className="game panel"><div className="section-label">06 / REMEMBER <span>{Object.keys(answers).length} / {questions.length || '—'} ANSWERED</span></div><h2>Article activity</h2><p className="muted">Complete a passage from the article. Get immediate, source-backed feedback.</p>{questions.length ? <><div className="game-score">{score} / {questions.length} correct<button className="text-button" onClick={() => setAnswers({})}>Reset activity ↻</button></div>{questions.map((q, i) => <div className="question" key={q.id}><span className="micro">CHALLENGE {i + 1}</span><p>{q.prompt}</p><div className="options">{q.options.map(option => <button key={option} disabled={!!answers[q.id]} className={answers[q.id] ? option === q.answer ? 'correct' : answers[q.id] === option ? 'incorrect' : '' : ''} onClick={() => setAnswers(previous => ({ ...previous, [q.id]: option }))}>{option}</button>)}</div>{answers[q.id] && <div className="feedback" role="status">{answers[q.id] === q.answer ? 'Correct.' : `The answer is “${q.answer}”.`} <Evidence items={[q.evidence]} /></div>}</div>)}</> : <p className="placeholder">Your article becomes a recall activity once analysis is complete.</p>}</section>
        {state?.checks.length > 0 && <section className="panel checks"><div className="section-label">07 / SELF-CHECK</div><h2>Evidence & execution review</h2>{state.checks.map(check => <p key={check.name} className={check.passed ? 'passed' : 'failed'}>{check.passed ? '✓' : '!'} {check.name}</p>)}</section>}
        {state?.article && <details className="panel source-preview"><summary>Inspect uploaded source & sentence references</summary><Evidence items={state.article.sentences} /></details>}
        <button className="secondary contracts-toggle" onClick={() => setContracts(!contracts)}>{contracts ? 'Hide' : 'View'} tool contracts</button>
    {contracts && <section className="panel contracts"><h2>Tool contracts</h2><p>Fixed routing: every step follows the same sequence. No model calls. Source content is data and cannot change the workflow. Only image search makes network requests.</p>{Object.values(CONTRACTS).map(c => <details key={c.name}><summary>{c.name} — {c.description}</summary><dl>{Object.entries(c).filter(([key]) => !['name', 'description'].includes(key)).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl></details>)}</section>}
        <footer className="workspace-footer"><span>Built on functions. Grounded in your article.</span><button className="text-button" disabled={!logs.length} onClick={download}>Export execution report ↓</button></footer>
      </main>
      <aside className="errorLogger panel"><div className="panel-heading"><h2>Error Logs</h2><span className={`error-count ${errors.length ? 'has-errors' : ''}`}>{errors.length}</span></div><p className="micro error-subtitle">ERROR & RECOVERY LOG</p><div role="log" aria-label="Error log" aria-live="polite">{!errors.length ? <div className="healthy"><span>✓</span><b>No issues recorded</b><p>Validation, timeouts, and recovery events appear here throughout the run.</p></div> : errors.map((error, i) => <div className="error-entry" key={i}><span>{new Date(error.time).toLocaleTimeString()} · {error.tool}</span><b>{error.code}</b><p>{error.message}</p>{error.attempt && <small>Attempt {error.attempt}</small>}</div>)}</div><div className="boundaries"><span className="micro">EXECUTION BOUNDARIES</span><p>◎ Article stays in browser memory</p><p>◎ No API keys or model calls</p><p>◎ Image search shares 3 keywords</p><p>◎ External lookup: 8s, one retry</p></div></aside>
  </div>;
}
export default App;
