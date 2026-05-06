// Signal Ledger — Retrieval & Lifecycle Panel (Right Panel)
// 6 tabs: Targeted, Inferential, Framing, Audit, Evaluative, Kit Status

const TABS = [
  { id: 'targeted',    label: 'Targeted',   icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
  { id: 'inferential', label: 'Infer.',     icon: 'M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18' },
  { id: 'framing',     label: 'Framing',    icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
  { id: 'audit',       label: 'Audit',      icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { id: 'evaluative',  label: 'Eval.',      icon: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z' },
  { id: 'kit-status',  label: 'Kits',       icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7', count: 7 },
];

// ── Shared query form ──────────────────────────────────────────────────────
const QueryForm = ({ placeholder, onSubmit, extraFilters, loading }) => {
  const [query, setQuery] = React.useState('');
  return (
    <div style={rlStyles.queryForm}>
      <div style={{ display:'flex', gap:'6px', marginBottom: extraFilters ? '6px' : 0 }}>
        <div style={{ position:'relative', flex:1 }}>
          <svg style={{ position:'absolute', left:'9px', top:'50%', transform:'translateY(-50%)', color:'#334155', pointerEvents:'none' }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input
            style={rlStyles.queryInput}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onSubmit && onSubmit(query)}
            placeholder={placeholder}
          />
        </div>
        <button style={rlStyles.submitBtn} onClick={() => onSubmit && onSubmit(query)}>
          {loading ? '…' : 'Run'}
        </button>
      </div>
      {extraFilters}
    </div>
  );
};

const FilterRow = ({ children }) => (
  <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>{children}</div>
);

const FilterSelect = ({ value, onChange, options }) => (
  <select style={rlStyles.filterSelect} value={value} onChange={e => onChange(e.target.value)}>
    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

const DateInput = ({ value, onChange }) => (
  <input type="text" style={rlStyles.dateInput} value={value} onChange={e => onChange(e.target.value)} />
);

// ── Result rows ────────────────────────────────────────────────────────────
const ResultRow = ({ title, score, excerpt, published, contentType, completeness, articleId }) => (
  <div style={rlStyles.resultRow}>
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'8px', marginBottom:'3px' }}>
      <span style={{ fontFamily:"'Inter',sans-serif", fontSize:'11px', color:'#CBD5E1', lineHeight:1.4 }}>{title}</span>
      {score && <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'11px', fontWeight:500, color:'#60A5FA', flexShrink:0 }}>{score.toFixed(3)}</span>}
    </div>
    {excerpt && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:'10px', color:'#64748B', lineHeight:1.5, marginBottom:'3px' }}>"{excerpt}"</div>}
    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'#334155' }}>
      {published} · {contentType === 'Nate-feature-article' ? 'feature' : 'executive'} · {completeness}
    </div>
  </div>
);

// ── Tab: Targeted ──────────────────────────────────────────────────────────
const TargetedTab = () => {
  const [ran, setRan] = React.useState(true);
  const results = [
    { title:'The Orchestration Problem: How Multi-Agent Systems Break', score:0.924, excerpt:'Trust between agents is not symmetric — the orchestrator may trust sub-agents differently…', published:'2026-04-17', contentType:'Nate-feature-article', completeness:'complete' },
    { title:'Credential vs. Capability: What Agents Actually Trade', score:0.847, excerpt:'Multi-agent coordination fails not on capability gaps but on trust-signaling gaps…', published:'2026-03-28', contentType:'Nate-feature-article', completeness:'partial' },
    { title:'Executive Brief: AI Infrastructure Spend — Week of Apr 14', score:0.711, excerpt:null, published:'2026-04-14', contentType:'Nate-executive-briefing', completeness:'preview-only' },
  ];
  return (
    <div style={rlStyles.tabBody}>
      <QueryForm
        placeholder="article, claim, signpost, or structured_block…"
        onSubmit={() => setRan(true)}
        extraFilters={
          <FilterRow>
            <span style={rlStyles.filterLabel}>type</span>
            <FilterSelect value="all" onChange={() => {}} options={[{value:'all',label:'any type'},{value:'feature',label:'feature-article'},{value:'exec',label:'executive-briefing'}]} />
            <span style={rlStyles.filterLabel}>target</span>
            <FilterSelect value="article" onChange={() => {}} options={[{value:'article',label:'article'},{value:'claim',label:'claim'},{value:'signpost',label:'signpost'},{value:'block',label:'structured_block'}]} />
          </FilterRow>
        }
      />
      {ran && (
        <div style={rlStyles.resultsArea}>
          <div style={rlStyles.resultsHeader}>
            <span style={rlStyles.resultsMeta}>3 results · "multi-agent trust"</span>
            <span style={rlStyles.resultsMeta}>target: article</span>
          </div>
          {results.map((r, i) => <ResultRow key={i} {...r} />)}
        </div>
      )}
    </div>
  );
};

// ── Tab: Inferential ──────────────────────────────────────────────────────
const InferentialTab = () => {
  const [ran, setRan] = React.useState(true);
  return (
    <div style={rlStyles.tabBody}>
      <QueryForm placeholder="question about Nate's positions or arguments…" onSubmit={() => setRan(true)} />
      {ran && (
        <div style={rlStyles.resultsArea}>
          <div style={rlStyles.resultsHeader}>
            <span style={rlStyles.resultsMeta}>synthesis · 3 sources · 2026-02 → 2026-04</span>
          </div>
          <div style={rlStyles.synthesisBlock}>
            <div style={{ fontFamily:"'Inter',sans-serif", fontSize:'12px', color:'#CBD5E1', lineHeight:1.65, marginBottom:'10px' }}>
              Nate's position on multi-agent coordination shifted materially between February and April 2026.
              Early captures (Feb–Mar) frame orchestration as a sequential hand-off problem.
              Later captures (Apr) treat it as a concurrent trust-negotiation problem — a meaningful trajectory delta.
            </div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:'#3B82F6', marginBottom:'8px', padding:'4px 8px', background:'#0D1520', border:'1px solid #1E3A5F', borderRadius:'2px' }}>
              Δ temporal delta: framing shifted from sequential → concurrent · Feb 2026 → Apr 2026
            </div>
            <div style={rlStyles.subLabel}>Sources</div>
            {[{title:'The Orchestration Problem…', date:'2026-04-17', score:null},{title:'Credential vs. Capability…', date:'2026-03-28', score:null},{title:'The Subscription Decision Framework…', date:'2026-02-28', score:null}].map((s,i)=>(
              <div key={i} style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'#475569', marginBottom:'2px' }}>
                · {s.title} — {s.date}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Tab: Framing ──────────────────────────────────────────────────────────
const FramingTab = () => {
  const [ran, setRan] = React.useState(true);
  return (
    <div style={rlStyles.tabBody}>
      <QueryForm placeholder="rhetorical pattern, lens, or framing question…" onSubmit={() => setRan(true)} />
      {ran && (
        <div style={rlStyles.resultsArea}>
          <div style={rlStyles.resultsHeader}>
            <span style={rlStyles.resultsMeta}>framing · signposts + structured_blocks</span>
          </div>
          <div style={rlStyles.synthesisBlock}>
            <div style={{ fontFamily:"'Inter',sans-serif", fontSize:'12px', color:'#CBD5E1', lineHeight:1.65, marginBottom:'8px' }}>
              Nate consistently frames trust failures as architectural deficits, not behavioral ones. Recurring signpost pattern: problem stated as binary → reframed as gradient → framework proposed.
            </div>
            <div style={rlStyles.subLabel}>Matched Signposts</div>
            {['"The key insight here…"', '"What I\'m watching for…"', '"The contrarian take…"'].map((s,i) => (
              <div key={i} style={{ fontFamily:"'Inter',sans-serif", fontSize:'10px', color:'#94A3B8', borderLeft:'2px solid #1E3A5F', paddingLeft:'7px', marginBottom:'3px', lineHeight:1.4 }}>{s}</div>
            ))}
            <div style={rlStyles.subLabel} style={{marginTop:'8px', ...rlStyles.subLabel}}>Matched Structured Blocks</div>
            {['Trust Gradient Model — framework', 'Credential Ladder — taxonomy'].map((b,i) => (
              <div key={i} style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:'#A78BFA', padding:'2px 6px', background:'#160D30', border:'1px solid #2D1B69', borderRadius:'2px', marginBottom:'3px' }}>{b}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Tab: Audit ────────────────────────────────────────────────────────────
const AuditTab = () => {
  const [scope, setScope] = React.useState('completeness');
  const scopes = ['coverage','completeness','gaps','ingestion-health'];
  return (
    <div style={rlStyles.tabBody}>
      <div style={rlStyles.queryForm}>
        <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
          {scopes.map(s => (
            <button key={s} onClick={() => setScope(s)} style={{ ...rlStyles.scopeBtn, ...(scope===s ? rlStyles.scopeBtnActive : {}) }}>{s}</button>
          ))}
        </div>
      </div>
      <div style={rlStyles.resultsArea}>
        {scope === 'coverage' && (
          <div style={rlStyles.auditBlock}>
            <div style={rlStyles.auditRow}><span style={rlStyles.auditLabel}>total articles</span><span style={rlStyles.auditValue}>47</span></div>
            <div style={rlStyles.auditRow}><span style={rlStyles.auditLabel}>Nate-feature-article</span><span style={rlStyles.auditValue}>34</span></div>
            <div style={rlStyles.auditRow}><span style={rlStyles.auditLabel}>Nate-executive-briefing</span><span style={rlStyles.auditValue}>13</span></div>
            <div style={rlStyles.auditRow}><span style={rlStyles.auditLabel}>date range</span><span style={rlStyles.auditValue}>2026-02-12 → 2026-05-02</span></div>
          </div>
        )}
        {scope === 'completeness' && (
          <div style={rlStyles.auditBlock}>
            <div style={rlStyles.auditRow}><span style={rlStyles.auditLabel}>complete</span><span style={rlStyles.auditValue} style={{color:'#86EFAC'}}>31</span></div>
            <div style={rlStyles.auditRow}><span style={rlStyles.auditLabel}>preview-only</span><span style={rlStyles.auditValue} style={{color:'#C4B5FD'}}>12</span></div>
            <div style={rlStyles.auditRow}><span style={rlStyles.auditLabel}>partial</span><span style={rlStyles.auditValue} style={{color:'#FCD34D'}}>4</span></div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'#334155', marginTop:'8px', lineHeight:1.5 }}>
              preview-only = source-not-provided (12 executive briefings pre-Apr 29, free tier)<br/>
              partial = system-failed (4 articles · retry warranted)
            </div>
          </div>
        )}
        {scope === 'gaps' && (
          <div style={rlStyles.auditBlock}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:'#FCD34D', marginBottom:'6px' }}>▲ 1 open gap window</div>
            <div style={rlStyles.auditRow}><span style={rlStyles.auditLabel}>gap_start</span><span style={rlStyles.auditValue}>2026-02-12</span></div>
            <div style={rlStyles.auditRow}><span style={rlStyles.auditLabel}>gap_end</span><span style={rlStyles.auditValue}>2026-02-21</span></div>
            <div style={rlStyles.auditRow}><span style={rlStyles.auditLabel}>est. articles</span><span style={rlStyles.auditValue}>~10</span></div>
            <div style={rlStyles.auditRow}><span style={rlStyles.auditLabel}>resolution_path</span><span style={rlStyles.auditValue}>email-backfill</span></div>
            <div style={rlStyles.auditRow}><span style={rlStyles.auditLabel}>status</span><span style={{...rlStyles.auditValue, color:'#93C5FD'}}>acknowledged</span></div>
          </div>
        )}
        {scope === 'ingestion-health' && (
          <div style={rlStyles.auditBlock}>
            <div style={rlStyles.auditRow}><span style={rlStyles.auditLabel}>total events</span><span style={rlStyles.auditValue}>213</span></div>
            <div style={rlStyles.auditRow}><span style={rlStyles.auditLabel}>ingestion_succeeded</span><span style={{...rlStyles.auditValue,color:'#86EFAC'}}>47</span></div>
            <div style={rlStyles.auditRow}><span style={rlStyles.auditLabel}>ingestion_failed</span><span style={{...rlStyles.auditValue,color:'#F87171'}}>3</span></div>
            <div style={rlStyles.auditRow}><span style={rlStyles.auditLabel}>embedding_failed</span><span style={{...rlStyles.auditValue,color:'#F87171'}}>8</span></div>
            <div style={rlStyles.auditRow}><span style={rlStyles.auditLabel}>retry_attempted</span><span style={{...rlStyles.auditValue,color:'#FBBF24'}}>11</span></div>
            <div style={rlStyles.auditRow}><span style={rlStyles.auditLabel}>orphan events</span><span style={{...rlStyles.auditValue,color:'#F87171'}}>2</span></div>
            <div style={rlStyles.auditRow}><span style={rlStyles.auditLabel}>source-not-provided</span><span style={{...rlStyles.auditValue,color:'#C4B5FD'}}>12</span></div>
            <div style={rlStyles.auditRow}><span style={rlStyles.auditLabel}>system-failed</span><span style={{...rlStyles.auditValue,color:'#FCD34D'}}>4</span></div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Tab: Evaluative ───────────────────────────────────────────────────────
const EvaluativeTab = () => {
  const sessions = [
    { date:'2026-05-01', disposition:'maintain-current-tier', summary:'47 articles captured, strong feature coverage. Executive briefings improving post-upgrade. No degradation signals detected.' },
    { date:'2026-04-01', disposition:'upgrade-candidate', summary:'Free-tier preview-only rate too high (62%). Paid tier upgrade recommended to unlock full executive briefing access.' },
  ];
  const dispStyle = {
    'maintain-current-tier': { color:'#94A3B8', border:'1px solid #2D3748', bg:'#111418' },
    'upgrade-candidate': { color:'#86EFAC', border:'1px solid #163320', bg:'#14291C' },
    'degradation-signal': { color:'#FCD34D', border:'1px solid #3A2A10', bg:'#2C1F06' },
    'abandon-signal': { color:'#FCA5A5', border:'1px solid #3A1A1A', bg:'#2C0F0F' },
  };
  return (
    <div style={rlStyles.tabBody}>
      <div style={rlStyles.resultsArea}>
        <div style={rlStyles.resultsHeader}>
          <span style={rlStyles.resultsMeta}>Nate B. Jones · {sessions.length} sessions</span>
        </div>
        {sessions.map((s, i) => {
          const ds = dispStyle[s.disposition];
          return (
            <div key={i} style={rlStyles.resultRow}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:'#94A3B8' }}>{s.date}</span>
                <span style={{ display:'inline-flex', padding:'1px 6px', borderRadius:'2px', background:ds.bg, color:ds.color, border:ds.border, fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', fontWeight:500 }}>
                  {s.disposition}
                </span>
              </div>
              <div style={{ fontFamily:"'Inter',sans-serif", fontSize:'11px', color:'#64748B', lineHeight:1.5 }}>{s.summary}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Tab: Kit Status ───────────────────────────────────────────────────────
const KitStatusTab = () => {
  const [filter, setFilter] = React.useState('all');
  const kits = [
    { name:'Trust Gradient Model Prompt Kit', article:'The Orchestration Problem…', published:'2026-04-17', state:'unevaluated', stampDate:null },
    { name:'Credential Ladder Analysis', article:'Credential vs. Capability…', published:'2026-03-28', state:'conditionally-deferred', stampDate:'2026-04-20', trigger:'after Nate publishes follow-up on agent credentials' },
    { name:'Prompt Architecture Taxonomy Kit', article:'Prompt Engineering Is Dead…', published:'2026-03-14', state:'repeat-scheduled', stampDate:'2026-04-15', nextRun:'2026-06-14' },
    { name:'Subscription Decision Framework', article:'The Subscription Decision…', published:'2026-02-28', state:'one-time', stampDate:'2026-03-10' },
  ];
  const filtered = filter === 'all' ? kits : kits.filter(k => k.state === filter);
  const stateStyle = {
    'unevaluated':          { color:'#94A3B8', border:'1px solid #1E2530', bg:'#161C23' },
    'repeat-scheduled':     { color:'#86EFAC', border:'1px solid #163320', bg:'#14291C' },
    'conditionally-deferred': { color:'#93C5FD', border:'1px solid #1E4A7A', bg:'#1E3A5F' },
    'one-time':             { color:'#64748B', border:'1px solid #1E2530', bg:'#161A20' },
  };
  return (
    <div style={rlStyles.tabBody}>
      <div style={rlStyles.queryForm}>
        <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
          {['all','unevaluated','repeat-scheduled','conditionally-deferred','one-time'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ ...rlStyles.scopeBtn, ...(filter===f ? rlStyles.scopeBtnActive : {}) }}>{f}</button>
          ))}
        </div>
      </div>
      <div style={rlStyles.resultsArea}>
        {filtered.map((k, i) => {
          const ss = stateStyle[k.state];
          return (
            <div key={i} style={rlStyles.resultRow}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'8px', marginBottom:'3px' }}>
                <span style={{ fontFamily:"'Inter',sans-serif", fontSize:'11px', color:'#CBD5E1' }}>{k.name}</span>
                <span style={{ display:'inline-flex', padding:'1px 6px', borderRadius:'2px', background:ss.bg, color:ss.color, border:ss.border, fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', fontWeight:500, flexShrink:0 }}>
                  {k.state}
                </span>
              </div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'#475569', marginBottom:'2px' }}>
                {k.article} · {k.published}
              </div>
              {k.nextRun && <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'#4ADE80' }}>next_run: {k.nextRun}</div>}
              {k.trigger && <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'#60A5FA' }}>trigger: {k.trigger}</div>}
              {k.stampDate && <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'#334155' }}>last stamp: {k.stampDate}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Main panel ────────────────────────────────────────────────────────────
const RetrievalLifecycle = () => {
  const [activeTab, setActiveTab] = React.useState('targeted');
  const unevalCount = 1;

  const TAB_CONTENT = {
    targeted:    <TargetedTab />,
    inferential: <InferentialTab />,
    framing:     <FramingTab />,
    audit:       <AuditTab />,
    evaluative:  <EvaluativeTab />,
    'kit-status': <KitStatusTab />,
  };

  return (
    <div style={rlStyles.panel}>
      {/* Header */}
      <div style={rlStyles.header}>
        <span style={rlStyles.title}>Retrieval &amp; Lifecycle</span>
        <span style={rlStyles.meta}>11 MCP tools</span>
      </div>
      {/* Tabs — explicit 3×2 grid so all 6 are always visible */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        borderBottom: '1px solid #1E2530',
        flexShrink: 0,
        background: '#0F1318',
      }}>
        {TABS.map(tab => (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: '4px', padding: '6px 4px',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '10px', cursor: 'pointer', whiteSpace: 'nowrap',
              transition: 'color 150ms, background 150ms',
              color: activeTab === tab.id ? '#E2E8F0' : '#475569',
              borderBottom: activeTab === tab.id ? '2px solid #3B82F6' : '2px solid transparent',
              background: activeTab === tab.id ? '#0D1520' : 'transparent',
              borderRight: '1px solid #151A20',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d={tab.icon} />
            </svg>
            {tab.label}
            {tab.id === 'kit-status' && unevalCount > 0 && (
              <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', minWidth:'13px', height:'12px', padding:'0 3px', background:'#1E3A5F', borderRadius:'2px', fontSize:'8px', fontWeight:500, color:'#93C5FD' }}>{unevalCount}</span>
            )}
          </div>
        ))}
      </div>
      {/* Content */}
      <div style={{ flex:1, overflowY:'auto' }}>
        {TAB_CONTENT[activeTab]}
      </div>
    </div>
  );
};

// Shared styles
const rlStyles = {
  panel: { display:'flex', flexDirection:'column', background:'#111418', border:'1px solid #1E2530', width:'380px', minWidth:'340px', flexShrink:0, overflow:'hidden' },
  header: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderBottom:'1px solid #1E2530', background:'#181D22', flexShrink:0 },
  title: { fontFamily:"'Inter',sans-serif", fontSize:'12px', fontWeight:600, color:'#E2E8F0' },
  meta: { fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'#475569' },
  tabBar: { display:'flex', flexWrap:'wrap', borderBottom:'1px solid #1E2530', flexShrink:0, background:'#0F1318' },
  tab: { display:'flex', alignItems:'center', gap:'4px', padding:'6px 10px', fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', cursor:'pointer', whiteSpace:'nowrap', transition:'color 150ms, background 150ms', flexShrink:0 },
  tabBody: { padding:'0' },
  queryForm: { padding:'10px 12px', borderBottom:'1px solid #1E2530', display:'flex', flexDirection:'column', gap:'6px' },
  queryInput: { width:'100%', height:'30px', paddingLeft:'30px', paddingRight:'8px', background:'#0A0C0F', border:'1px solid #1E2530', borderRadius:'4px', fontFamily:"'JetBrains Mono',monospace", fontSize:'11px', color:'#E2E8F0', outline:'none' },
  submitBtn: { height:'30px', padding:'0 12px', background:'#3B82F6', border:'none', borderRadius:'4px', fontFamily:"'JetBrains Mono',monospace", fontSize:'11px', fontWeight:500, color:'#fff', cursor:'pointer', flexShrink:0 },
  filterLabel: { fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'#334155', textTransform:'uppercase', letterSpacing:'0.07em', flexShrink:0 },
  filterSelect: { height:'26px', padding:'0 6px', background:'#0A0C0F', border:'1px solid #1E2530', borderRadius:'4px', fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:'#94A3B8', outline:'none', cursor:'pointer' },
  dateInput: { height:'26px', padding:'0 6px', background:'#0A0C0F', border:'1px solid #1E2530', borderRadius:'4px', fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:'#94A3B8', width:'90px', outline:'none' },
  resultsArea: { borderTop:'none' },
  resultsHeader: { display:'flex', justifyContent:'space-between', padding:'5px 12px', borderBottom:'1px solid #1E2530', background:'#0F1318' },
  resultsMeta: { fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'#334155' },
  resultRow: { padding:'8px 12px', borderBottom:'1px solid #151A20' },
  synthesisBlock: { padding:'10px 12px' },
  subLabel: { fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', fontWeight:600, color:'#334155', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'4px', marginTop:'6px' },
  auditBlock: { padding:'10px 12px' },
  auditRow: { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'4px 0', borderBottom:'1px solid #151A20' },
  auditLabel: { fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:'#475569' },
  auditValue: { fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', fontWeight:500, color:'#CBD5E1' },
  scopeBtn: { padding:'2px 8px', background:'#111418', border:'1px solid #1E2530', borderRadius:'2px', fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'#475569', cursor:'pointer' },
  scopeBtnActive: { background:'#0D1520', border:'1px solid #3B82F6', color:'#93C5FD' },
};

Object.assign(window, { RetrievalLifecycle });
