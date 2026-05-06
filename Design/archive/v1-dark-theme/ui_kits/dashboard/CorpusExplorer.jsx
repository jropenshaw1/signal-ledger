// Signal Ledger — Corpus Explorer (Center Panel)
// Article inventory with sort, filter, and expandable rows

const SAMPLE_ARTICLES = [
  {
    id: 'a3f2c1d0', title: 'The Orchestration Problem: How Multi-Agent Systems Break',
    published: '2026-04-17', contentType: 'Nate-feature-article',
    completeness: 'complete', embeddingStatus: 'complete', kitCount: 3,
    signposts: [
      '"The key insight here is that trust between agents is not symmetric…"',
      '"What I\'m watching for in Q2: whether orchestration failures cluster around…"',
    ],
    claims: [{ text: 'Gartner projects 80% of enterprise AI deployments will include multi-agent coordination by 2027.', attribution: 'Gartner', type: 'statistic' }],
    blocks: [{ name: 'Trust Gradient Model', type: 'framework', kitCandidate: true }],
  },
  {
    id: 'b7e1d4f2', title: 'Executive Brief: AI Infrastructure Spend — Week of Apr 14',
    published: '2026-04-14', contentType: 'Nate-executive-briefing',
    completeness: 'preview-only', embeddingStatus: null, kitCount: 0,
    signposts: [], claims: [], blocks: [],
  },
  {
    id: 'c9d2e5f3', title: 'Credential vs. Capability: What Agents Actually Trade',
    published: '2026-03-28', contentType: 'Nate-feature-article',
    completeness: 'partial', embeddingStatus: 'pending', kitCount: 1,
    signposts: ['"The credential economy is not about proof of work — it is about proof of trustworthiness…"'],
    claims: [],
    blocks: [{ name: 'Credential Ladder', type: 'taxonomy', kitCandidate: false }],
  },
  {
    id: 'd1e3f4a5', title: 'Prompt Engineering Is Dead. Long Live Prompt Architecture.',
    published: '2026-03-14', contentType: 'Nate-feature-article',
    completeness: 'complete', embeddingStatus: 'processing', kitCount: 2,
    signposts: ['"The contrarian take: prompt templates are the new if-statements…"'],
    claims: [{ text: 'OpenAI internal data shows 60% of GPT-4 failures trace to prompt structure, not model capability.', attribution: 'OpenAI (reported)', type: 'statistic' }],
    blocks: [{ name: 'Prompt Architecture Taxonomy', type: 'taxonomy', kitCandidate: true }],
  },
  {
    id: 'e5f6a7b8', title: 'The Subscription Decision Framework for AI Content',
    published: '2026-02-28', contentType: 'Nate-feature-article',
    completeness: 'complete', embeddingStatus: 'complete', kitCount: 1,
    signposts: ['"Signal-to-noise ratio is the only metric that matters for paid subscriptions…"'],
    claims: [],
    blocks: [],
  },
  {
    id: 'f7a8b9c0', title: 'Executive Brief: Model Releases Tracker — Week of Feb 24',
    published: '2026-02-24', contentType: 'Nate-executive-briefing',
    completeness: 'preview-only', embeddingStatus: null, kitCount: 0,
    signposts: [], claims: [], blocks: [],
  },
];

const COMPLETENESS_BADGE = {
  'complete':     { symbol: '●', bg: '#14291C', color: '#86EFAC', border: '#163320' },
  'preview-only': { symbol: '◐', bg: '#1E1040', color: '#C4B5FD', border: '#2D1B69' },
  'partial':      { symbol: '◑', bg: '#2C1F06', color: '#FCD34D', border: '#3A2A10' },
};

const EMBEDDING_DISPLAY = {
  'complete':   { symbol: '●', color: '#86EFAC' },
  'processing': { symbol: null, color: '#93C5FD' },
  'pending':    { symbol: '○', color: '#64748B' },
  'failed':     { symbol: '✕', color: '#F87171' },
  null:         { symbol: '—', color: '#334155' },
};

const CONTENT_TYPE_BADGE = {
  'Nate-feature-article':     { bg: '#0D1520', color: '#60A5FA', border: '#1E3A5F', short: 'feature' },
  'Nate-executive-briefing':  { bg: '#160D30', color: '#A78BFA', border: '#2D1B69', short: 'executive' },
};

const PulsingDot = () => {
  const [op, setOp] = React.useState(1);
  React.useEffect(() => {
    let dir = -1;
    const iv = setInterval(() => setOp(o => { const n = o + dir * 0.04; if (n <= 0.3) dir=1; if (n >= 1) dir=-1; return n; }), 50);
    return () => clearInterval(iv);
  }, []);
  return <span style={{ display:'inline-block', width:'6px', height:'6px', background:'#60A5FA', borderRadius:'50%', opacity:op }} />;
};

const Badge = ({ completeness }) => {
  const b = COMPLETENESS_BADGE[completeness];
  if (!b) return null;
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:'3px', padding:'1px 5px', borderRadius:'2px', background:b.bg, color:b.color, border:`1px solid ${b.border}`, fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', fontWeight:500, whiteSpace:'nowrap' }}>
      {b.symbol} {completeness}
    </span>
  );
};

const EmbeddingStatus = ({ status }) => {
  const d = EMBEDDING_DISPLAY[status] || EMBEDDING_DISPLAY[null];
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:'4px', fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:d.color }}>
      {status === 'processing' ? <PulsingDot /> : d.symbol} {status || 'n/a'}
    </span>
  );
};

const ExpandedRow = ({ article }) => (
  <div style={ceStyles.subPanel}>
    {article.signposts.length > 0 && (
      <div style={ceStyles.subSection}>
        <div style={ceStyles.subLabel}>Author Signposts</div>
        {article.signposts.map((s, i) => (
          <div key={i} style={ceStyles.signpost}>{s}</div>
        ))}
      </div>
    )}
    {article.claims.length > 0 && (
      <div style={ceStyles.subSection}>
        <div style={ceStyles.subLabel}>Cited Claims ({article.claims.length})</div>
        {article.claims.map((c, i) => (
          <div key={i} style={ceStyles.claim}>
            <div>{c.text}</div>
            <div style={ceStyles.claimMeta}>attributed_to: {c.attribution || 'n/a'} · claim_type: {c.type} · {article.published}</div>
          </div>
        ))}
      </div>
    )}
    {article.blocks.length > 0 && (
      <div style={ceStyles.subSection}>
        <div style={ceStyles.subLabel}>Structured Technical Content ({article.blocks.length})</div>
        {article.blocks.map((b, i) => (
          <div key={i} style={ceStyles.block}>
            {b.name} — {b.type} · kit_candidate: {b.kitCandidate ? 'true' : 'false'}
          </div>
        ))}
      </div>
    )}
    {article.completeness === 'preview-only' && (
      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:'#475569', padding:'4px 0' }}>
        ◐ preview-only — source did not provide full content (source-not-provided · Charter P9)
      </div>
    )}
  </div>
);

const CorpusExplorer = ({ articles = SAMPLE_ARTICLES }) => {
  const [expandedId, setExpandedId] = React.useState('a3f2c1d0');
  const [sortField, setSortField] = React.useState('published');
  const [filterType, setFilterType] = React.useState('all');
  const [filterCompleteness, setFilterCompleteness] = React.useState('all');

  const filtered = articles.filter(a => {
    if (filterType !== 'all' && a.contentType !== filterType) return false;
    if (filterCompleteness !== 'all' && a.completeness !== filterCompleteness) return false;
    return true;
  });

  return (
    <div style={ceStyles.panel}>
      {/* Header */}
      <div style={ceStyles.header}>
        <span style={ceStyles.title}>Corpus Explorer</span>
        <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
          <select style={ceStyles.select} value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="all">all types</option>
            <option value="Nate-feature-article">feature-article</option>
            <option value="Nate-executive-briefing">executive-briefing</option>
          </select>
          <select style={ceStyles.select} value={filterCompleteness} onChange={e => setFilterCompleteness(e.target.value)}>
            <option value="all">all completeness</option>
            <option value="complete">complete</option>
            <option value="preview-only">preview-only</option>
            <option value="partial">partial</option>
          </select>
          <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'#334155' }}>{filtered.length} articles</span>
        </div>
      </div>

      {/* Column headers */}
      <div style={ceStyles.colHeaders}>
        <div style={{ flex:1, minWidth:0 }}><span style={ceStyles.colH} onClick={() => setSortField('title')} >Title {sortField==='title'?'↑':''}</span></div>
        <div style={{ width:'82px', flexShrink:0 }}><span style={ceStyles.colH} onClick={() => setSortField('published')}>Published {sortField==='published'?'↓':''}</span></div>
        <div style={{ width:'80px', flexShrink:0 }}><span style={ceStyles.colH}>Type</span></div>
        <div style={{ width:'94px', flexShrink:0 }}><span style={ceStyles.colH}>Completeness</span></div>
        <div style={{ width:'72px', flexShrink:0 }}><span style={ceStyles.colH}>Embedding</span></div>
        <div style={{ width:'36px', flexShrink:0, textAlign:'right' }}><span style={ceStyles.colH}>Kits</span></div>
      </div>

      {/* Rows */}
      <div style={{ flex:1, overflowY:'auto' }}>
        {filtered.map(article => {
          const isOpen = expandedId === article.id;
          const ct = CONTENT_TYPE_BADGE[article.contentType];
          return (
            <React.Fragment key={article.id}>
              <div
                onClick={() => setExpandedId(isOpen ? null : article.id)}
                style={{
                  ...ceStyles.articleRow,
                  background: isOpen ? '#0D1520' : 'transparent',
                  borderLeft: isOpen ? '2px solid #3B82F6' : '2px solid transparent',
                }}
              >
                <div style={{ flex:1, minWidth:0, display:'flex', alignItems:'center', gap:'6px' }}>
                  <span style={{ fontSize:'9px', color: isOpen ? '#3B82F6' : '#334155', transform: isOpen ? 'rotate(90deg)' : 'none', display:'inline-block', transition:'transform 150ms', flexShrink:0 }}>▶</span>
                  <span style={{ fontFamily:"'Inter',sans-serif", fontSize:'12px', color:'#CBD5E1', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{article.title}</span>
                </div>
                <div style={{ width:'82px', flexShrink:0 }}>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:'#64748B' }}>{article.published}</span>
                </div>
                <div style={{ width:'80px', flexShrink:0 }}>
                  <span style={{ display:'inline-flex', padding:'1px 5px', borderRadius:'2px', background:ct?.bg, color:ct?.color, border:`1px solid ${ct?.border}`, fontFamily:"'JetBrains Mono',monospace", fontSize:'8px', fontWeight:500 }}>
                    {ct?.short}
                  </span>
                </div>
                <div style={{ width:'94px', flexShrink:0 }}><Badge completeness={article.completeness} /></div>
                <div style={{ width:'72px', flexShrink:0 }}><EmbeddingStatus status={article.embeddingStatus} /></div>
                <div style={{ width:'36px', flexShrink:0, textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color: article.kitCount > 0 ? '#94A3B8' : '#334155' }}>
                  {article.kitCount > 0 ? article.kitCount : '—'}
                </div>
              </div>
              {isOpen && <ExpandedRow article={article} />}
            </React.Fragment>
          );
        })}
      </div>

      {/* Footer */}
      <div style={ceStyles.footer}>
        {['complete','preview-only','partial'].map(c => {
          const b = COMPLETENESS_BADGE[c];
          const count = articles.filter(a => a.completeness === c).length;
          return <span key={c} style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:b.color }}>{b.symbol} {count} {c}</span>;
        })}
      </div>
    </div>
  );
};

const ceStyles = {
  panel: { display:'flex', flexDirection:'column', background:'#111418', border:'1px solid #1E2530', flex:1, minWidth:0, overflow:'hidden' },
  header: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderBottom:'1px solid #1E2530', background:'#181D22', flexShrink:0 },
  title: { fontFamily:"'Inter',sans-serif", fontSize:'12px', fontWeight:600, color:'#E2E8F0' },
  select: { height:'24px', padding:'0 6px', background:'#0A0C0F', border:'1px solid #1E2530', borderRadius:'4px', fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:'#94A3B8', outline:'none', cursor:'pointer' },
  colHeaders: { display:'flex', alignItems:'center', gap:'8px', padding:'4px 12px', borderBottom:'1px solid #1E2530', background:'#0F1318', flexShrink:0 },
  colH: { fontFamily:"'JetBrains Mono',monospace", fontSize:'8px', fontWeight:500, color:'#334155', textTransform:'uppercase', letterSpacing:'0.07em', cursor:'pointer' },
  articleRow: { display:'flex', alignItems:'center', gap:'8px', padding:'0 10px', height:'36px', borderBottom:'1px solid #151A20', cursor:'pointer', transition:'background 150ms' },
  subPanel: { background:'#0D1118', borderTop:'1px solid #151A20', borderBottom:'1px solid #1E2530', padding:'10px 16px 12px 36px' },
  subSection: { marginBottom:'8px' },
  subLabel: { fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', fontWeight:600, color:'#334155', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'4px' },
  signpost: { fontFamily:"'Inter',sans-serif", fontSize:'11px', color:'#94A3B8', borderLeft:'2px solid #1E3A5F', paddingLeft:'8px', marginBottom:'3px', lineHeight:1.4 },
  claim: { fontFamily:"'Inter',sans-serif", fontSize:'11px', color:'#CBD5E1', padding:'4px 8px', background:'#111820', border:'1px solid #1E2530', borderRadius:'2px', marginBottom:'3px', lineHeight:1.4 },
  claimMeta: { fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'#334155', marginTop:'2px' },
  block: { fontFamily:"'Inter',sans-serif", fontSize:'11px', color:'#A78BFA', padding:'4px 8px', background:'#160D30', border:'1px solid #2D1B69', borderRadius:'2px', marginBottom:'3px', lineHeight:1.4 },
  footer: { display:'flex', gap:'14px', padding:'6px 12px', borderTop:'1px solid #1E2530', background:'#0F1318', flexShrink:0 },
};

Object.assign(window, { CorpusExplorer });
