// Signal Ledger — Retrieval & Lifecycle (light theme, brand_tokens.css)
// 6 tabs in 3×2 grid: Targeted, Inferential, Framing, Audit, Evaluative, Kit Status

const TABS = [
  { id:'targeted',    label:'Targeted',    icon:'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
  { id:'inferential', label:'Inferential', icon:'M22 12h-4l-3 9L9 3l-3 9H2' },
  { id:'framing',     label:'Framing',     icon:'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
  { id:'audit',       label:'Audit',       icon:'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { id:'evaluative',  label:'Evaluative',  icon:'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' },
  { id:'kit-status',  label:'Kit Status',  icon:'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7', count:1 },
];

const rl = {
  panel: { display:'flex', flexDirection:'column', background:'var(--bg-surface)', border:'1px solid var(--border-default)', width:'320px', flexShrink:0, overflow:'hidden' },
  header: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderBottom:'1px solid var(--border-default)', background:'var(--bg-header)', flexShrink:0 },
  qform: { padding:'10px 12px', borderBottom:'1px solid var(--border-default)', display:'flex', flexDirection:'column', gap:'6px', background:'var(--bg-surface)' },
  qinput: { width:'100%', height:'30px', paddingLeft:'28px', paddingRight:'8px', background:'var(--bg-elevated)', border:'1px solid var(--border-default)', borderRadius:'4px', fontFamily:"'JetBrains Mono',monospace", fontSize:'11px', color:'var(--text-primary)', outline:'none' },
  runBtn: { height:'30px', padding:'0 12px', background:'var(--accent-600)', border:'none', borderRadius:'4px', fontFamily:"'JetBrains Mono',monospace", fontSize:'11px', fontWeight:700, color:'var(--text-inverse)', cursor:'pointer' },
  fsel: { height:'26px', padding:'0 6px', background:'var(--bg-elevated)', border:'1px solid var(--border-default)', borderRadius:'4px', fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:'var(--text-secondary)', outline:'none', cursor:'pointer' },
  flabel: { fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', flexShrink:0 },
  rhead: { display:'flex', justifyContent:'space-between', padding:'5px 12px', borderBottom:'1px solid var(--border-subtle)', background:'var(--bg-inset)' },
  rmeta: { fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--text-muted)' },
  rrow: { padding:'8px 12px', borderBottom:'1px solid var(--border-subtle)' },
  sblock: { padding:'10px 12px' },
  slabel: { fontFamily:"'JetBrains Mono',monospace", fontSize:'8px', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'4px', marginTop:'6px' },
  arow: { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'4px 0', borderBottom:'1px solid var(--border-subtle)' },
  alabel: { fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:'var(--text-muted)' },
  aval: { fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', fontWeight:500, color:'var(--text-secondary)' },
  sbtn: { padding:'2px 8px', background:'var(--bg-inset)', border:'1px solid var(--border-default)', borderRadius:'2px', fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--text-muted)', cursor:'pointer' },
  sbtnA: { background:'var(--accent-100)', border:'1px solid var(--accent-border)', color:'var(--accent-700)', fontWeight:700 },
};

const QForm = ({ placeholder, onRun, filters }) => {
  const [q,setQ] = React.useState('');
  return (
    <div style={rl.qform}>
      <div style={{ display:'flex', gap:'6px' }}>
        <div style={{ position:'relative', flex:1 }}>
          <svg style={{ position:'absolute', left:'8px', top:'50%', transform:'translateY(-50%)', color:'var(--text-disabled)', pointerEvents:'none' }} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input style={rl.qinput} value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&onRun&&onRun(q)} placeholder={placeholder} />
        </div>
        <button style={rl.runBtn} onClick={()=>onRun&&onRun(q)}>Run</button>
      </div>
      {filters}
    </div>
  );
};

const ResultRow = ({ title, score, excerpt, published, contentType, completeness }) => {
  const ctShort = contentType==='Nate-feature-article'?'feature':'executive';
  return (
    <div style={rl.rrow}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'8px', marginBottom:'3px' }}>
        <span style={{ fontFamily:"'Inter',sans-serif", fontSize:'11px', color:'var(--text-primary)', lineHeight:1.4 }}>{title}</span>
        {score && <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'11px', fontWeight:700, color:'var(--accent-600)', flexShrink:0 }}>{score.toFixed(3)}</span>}
      </div>
      {excerpt && <div style={{ fontFamily:"'Inter',sans-serif", fontStyle:'italic', fontSize:'10px', color:'var(--text-secondary)', lineHeight:1.5, marginBottom:'3px' }}>"{excerpt}"</div>}
      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--text-muted)' }}>{published} · {ctShort} · {completeness}</div>
    </div>
  );
};

// ── Targeted ───────────────────────────────────────────────────────────────
const TargetedTab = () => (
  <div>
    <QForm placeholder="article, claim, signpost, structured_block…" filters={
      <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
        <span style={rl.flabel}>type</span>
        <select style={rl.fsel}><option>any type</option><option>feature-article</option><option>executive-briefing</option></select>
        <span style={rl.flabel}>target</span>
        <select style={rl.fsel}><option>article</option><option>claim</option><option>signpost</option><option>structured_block</option></select>
      </div>
    }/>
    <div style={rl.rhead}><span style={rl.rmeta}>3 results · "multi-agent trust"</span><span style={rl.rmeta}>target: article</span></div>
    <ResultRow title="The Orchestration Problem: How Multi-Agent Systems Break" score={0.924} excerpt="Trust between agents is not symmetric…" published="2026-04-17" contentType="Nate-feature-article" completeness="complete"/>
    <ResultRow title="Credential vs. Capability: What Agents Actually Trade" score={0.847} excerpt="Multi-agent coordination fails not on capability gaps but on trust-signaling gaps…" published="2026-03-28" contentType="Nate-feature-article" completeness="partial"/>
    <ResultRow title="Executive Brief: AI Infrastructure Spend — Week of Apr 14" score={0.711} excerpt={null} published="2026-04-14" contentType="Nate-executive-briefing" completeness="preview-only"/>
  </div>
);

// ── Inferential ────────────────────────────────────────────────────────────
const InferentialTab = () => (
  <div>
    <QForm placeholder="question about Nate's positions or arguments…"/>
    <div style={rl.rhead}><span style={rl.rmeta}>synthesis · 3 sources · 2026-02 → 2026-04</span></div>
    <div style={rl.sblock}>
      <p style={{ fontFamily:"'Inter',sans-serif", fontSize:'12px', color:'var(--text-primary)', lineHeight:'var(--lh-relaxed)', marginBottom:'8px' }}>
        Nate's position on multi-agent coordination shifted materially between February and April 2026. Early captures frame orchestration as a sequential hand-off problem. Later captures treat it as a concurrent trust-negotiation problem — a meaningful trajectory delta.
      </p>
      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:'var(--accent-700)', marginBottom:'8px', padding:'4px 8px', background:'var(--accent-100)', border:'1px solid var(--accent-border)', borderRadius:'2px' }}>
        Δ temporal delta: framing shifted from sequential → concurrent · Feb 2026 → Apr 2026
      </div>
      <div style={rl.slabel}>Sources</div>
      {[['The Orchestration Problem…','2026-04-17'],['Credential vs. Capability…','2026-03-28'],['The Subscription Decision Framework…','2026-02-28']].map(([t,d])=>(
        <div key={d} style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--text-muted)', marginBottom:'2px' }}>· {t} — {d}</div>
      ))}
    </div>
  </div>
);

// ── Framing ────────────────────────────────────────────────────────────────
const FramingTab = () => (
  <div>
    <QForm placeholder="rhetorical pattern, lens, or framing question…"/>
    <div style={rl.rhead}><span style={rl.rmeta}>framing · signposts + structured_blocks</span></div>
    <div style={rl.sblock}>
      <p style={{ fontFamily:"'Inter',sans-serif", fontSize:'12px', color:'var(--text-primary)', lineHeight:'var(--lh-relaxed)', marginBottom:'8px' }}>
        Nate consistently frames trust failures as architectural deficits. Recurring pattern: problem stated as binary → reframed as gradient → framework proposed.
      </p>
      <div style={rl.slabel}>Matched Signposts</div>
      {['"The key insight here…"','"What I\'m watching for…"','"The contrarian take…"'].map((s,i)=>(
        <div key={i} style={{ fontFamily:"'Inter',sans-serif", fontStyle:'italic', fontSize:'10px', color:'var(--text-secondary)', borderLeft:'2px solid var(--border-elevated)', paddingLeft:'7px', marginBottom:'3px', lineHeight:1.4 }}>{s}</div>
      ))}
      <div style={rl.slabel}>Matched Structured Blocks</div>
      {['Trust Gradient Model — framework','Credential Ladder — taxonomy'].map((b,i)=>(
        <div key={i} style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:'var(--info-700)', padding:'2px 6px', background:'var(--info-100)', border:'1px solid var(--info-600)', borderRadius:'2px', marginBottom:'3px' }}>{b}</div>
      ))}
    </div>
  </div>
);

// ── Audit ──────────────────────────────────────────────────────────────────
const AuditTab = () => {
  const [scope,setScope] = React.useState('completeness');
  const scopes = ['coverage','completeness','gaps','ingestion-health'];
  const ARow = ({label,value,vc}) => <div style={rl.arow}><span style={rl.alabel}>{label}</span><span style={{...rl.aval,color:vc||'var(--text-secondary)'}}>{value}</span></div>;
  return (
    <div>
      <div style={{ padding:'8px 12px', borderBottom:'1px solid var(--border-default)', display:'flex', gap:'4px', flexWrap:'wrap', background:'var(--bg-surface)' }}>
        {scopes.map(s=><button key={s} onClick={()=>setScope(s)} style={{...rl.sbtn,...(scope===s?rl.sbtnA:{})}}>{s}</button>)}
      </div>
      <div style={{ padding:'10px 12px' }}>
        {scope==='coverage'&&<><ARow label="total_articles" value="47"/><ARow label="Nate-feature-article" value="34"/><ARow label="Nate-executive-briefing" value="13"/><ARow label="date_range" value="2026-02-12 → 2026-05-02"/></>}
        {scope==='completeness'&&<><ARow label="complete" value="31" vc="var(--success-700)"/><ARow label="preview-only" value="12" vc="var(--info-700)"/><ARow label="partial" value="4" vc="var(--warning-700)"/><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:'9px',color:'var(--text-muted)',marginTop:'8px',lineHeight:1.6}}>preview-only = source-not-provided · partial = system-failed (Charter P9)</div></>}
        {scope==='gaps'&&<><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:'10px',color:'var(--warning-700)',marginBottom:'6px'}}>▲ 1 open gap window</div><ARow label="gap_start" value="2026-02-12"/><ARow label="gap_end" value="2026-02-21"/><ARow label="est. articles" value="~10"/><ARow label="resolution_path" value="email-backfill" vc="var(--info-700)"/><ARow label="status" value="acknowledged" vc="var(--accent-700)"/></>}
        {scope==='ingestion-health'&&<><ARow label="total_events" value="213"/><ARow label="ingestion_succeeded" value="47" vc="var(--success-700)"/><ARow label="ingestion_failed" value="3" vc="var(--danger-700)"/><ARow label="embedding_failed" value="8" vc="var(--danger-700)"/><ARow label="retry_attempted" value="11" vc="var(--warning-700)"/><ARow label="orphan_events" value="2" vc="var(--danger-700)"/><ARow label="source-not-provided" value="12" vc="var(--info-700)"/><ARow label="system-failed" value="4" vc="var(--warning-700)"/></>}
      </div>
    </div>
  );
};

// ── Evaluative ─────────────────────────────────────────────────────────────
const EvaluativeTab = () => {
  const sessions = [
    { date:'2026-05-01', disposition:'maintain-current-tier', summary:'47 articles captured, strong feature coverage. Executive briefings improving post-upgrade. No degradation signals.' },
    { date:'2026-04-01', disposition:'upgrade-candidate', summary:'Free-tier preview-only rate too high (62%). Paid tier upgrade recommended to unlock full executive briefing access.' },
  ];
  const ds = {
    'maintain-current-tier': { bg:'var(--bg-inset)', color:'var(--text-secondary)', border:'1px solid var(--border-default)' },
    'upgrade-candidate':     { bg:'var(--success-100)', color:'var(--success-900)', border:'1px solid var(--success-500)' },
    'degradation-signal':    { bg:'var(--warning-100)', color:'var(--warning-900)', border:'1px solid var(--warning-600)' },
    'abandon-signal':        { bg:'var(--danger-100)', color:'var(--danger-900)', border:'1px solid var(--danger-600)' },
  };
  return (
    <div>
      <div style={rl.rhead}><span style={rl.rmeta}>Nate B. Jones · {sessions.length} sessions · upgrade-candidate → maintain</span></div>
      {sessions.map((s,i)=>{
        const d = ds[s.disposition];
        return (
          <div key={i} style={{ ...rl.rrow, borderLeft: i===0?'3px solid var(--border-focus)':'' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:'var(--text-muted)' }}>{s.date}</span>
              <span style={{ display:'inline-flex', padding:'1px 6px', borderRadius:'2px', fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', fontWeight:700, background:d.bg, color:d.color, border:d.border }}>{s.disposition}</span>
            </div>
            <div style={{ fontFamily:"'Inter',sans-serif", fontSize:'11px', color:'var(--text-secondary)', lineHeight:1.5 }}>{s.summary}</div>
          </div>
        );
      })}
    </div>
  );
};

// ── Kit Status ─────────────────────────────────────────────────────────────
const KitStatusTab = () => {
  const [filter,setFilter] = React.useState('all');
  const kits = [
    { name:'Trust Gradient Model Prompt Kit', article:'The Orchestration Problem…', published:'2026-04-17', state:'unevaluated', stampDate:null, execCtx:null, nextRun:null, trigger:null },
    { name:'Credential Ladder Analysis', article:'Credential vs. Capability…', published:'2026-03-28', state:'conditionally-deferred', stampDate:'2026-04-20', execCtx:'LucidLink interview prep 2026-04-20', trigger:'after Nate publishes follow-up on agent credentials' },
    { name:'Prompt Architecture Taxonomy Kit', article:'Prompt Engineering Is Dead…', published:'2026-03-14', state:'repeat-scheduled', stampDate:'2026-04-15', execCtx:'Monthly architecture review 2026-04-15', nextRun:'2026-06-14' },
    { name:'Subscription Decision Framework', article:'The Subscription Decision…', published:'2026-02-28', state:'one-time', stampDate:'2026-03-10', execCtx:'Subscription review Q1 2026' },
  ];
  const filters = ['all','unevaluated','repeat-scheduled','conditionally-deferred','one-time'];
  const filtered = filter==='all'?kits:kits.filter(k=>k.state===filter);
  const ss = {
    'unevaluated':           { bg:'var(--bg-inset)',    color:'var(--text-muted)',    border:'1px solid var(--border-default)' },
    'repeat-scheduled':      { bg:'var(--success-100)', color:'var(--success-900)',   border:'1px solid var(--success-500)' },
    'conditionally-deferred':{ bg:'var(--accent-100)',  color:'var(--accent-700)',    border:'1px solid var(--accent-border)' },
    'one-time':              { bg:'var(--bg-inset)',    color:'var(--text-secondary)', border:'1px solid var(--border-default)' },
  };
  return (
    <div>
      <div style={{ padding:'8px 12px', borderBottom:'1px solid var(--border-default)', display:'flex', gap:'4px', flexWrap:'wrap', background:'var(--bg-surface)' }}>
        {filters.map(f=><button key={f} onClick={()=>setFilter(f)} style={{...rl.sbtn,...(filter===f?rl.sbtnA:{})}}>{f}</button>)}
      </div>
      {filtered.map((k,i)=>{
        const s = ss[k.state];
        return (
          <div key={i} style={rl.rrow}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'6px', marginBottom:'3px' }}>
              <span style={{ fontFamily:"'Inter',sans-serif", fontSize:'11px', color:'var(--text-primary)', lineHeight:1.35 }}>{k.name}</span>
              <span style={{ display:'inline-flex', padding:'1px 5px', borderRadius:'2px', fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', fontWeight:700, flexShrink:0, background:s.bg, color:s.color, border:s.border }}>{k.state}</span>
            </div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--text-muted)', marginBottom:'2px' }}>{k.article} · {k.published}</div>
            {k.stampDate && <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--text-muted)' }}>stamp_date: {k.stampDate}</div>}
            {k.execCtx && <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--text-secondary)', marginTop:'1px' }}>execution_context: {k.execCtx}</div>}
            {k.nextRun && <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--success-700)', marginTop:'1px' }}>next_run_date: {k.nextRun}</div>}
            {k.trigger && <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--accent-600)', marginTop:'1px' }}>trigger_condition: {k.trigger}</div>}
          </div>
        );
      })}
    </div>
  );
};

// ── Main panel ─────────────────────────────────────────────────────────────
const RetrievalLifecycle = () => {
  const [active, setActive] = React.useState('targeted');
  const content = { targeted:<TargetedTab/>, inferential:<InferentialTab/>, framing:<FramingTab/>, audit:<AuditTab/>, evaluative:<EvaluativeTab/>, 'kit-status':<KitStatusTab/> };
  return (
    <div style={rl.panel}>
      <div style={rl.header}>
        <span style={{ fontFamily:"'Inter',sans-serif", fontSize:'12px', fontWeight:700, color:'var(--text-heading)' }}>Retrieval &amp; Lifecycle</span>
        <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--text-muted)' }}>11 MCP tools</span>
      </div>
      {/* 3×2 grid — guaranteed all 6 visible */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', borderBottom:'1px solid var(--border-default)', flexShrink:0, background:'var(--bg-inset)' }}>
        {TABS.map(tab=>{
          const isActive = active===tab.id;
          return (
            <div key={tab.id} onClick={()=>setActive(tab.id)} style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'4px', padding:'6px 4px', fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', cursor:'pointer', whiteSpace:'nowrap', color: isActive?'var(--accent-700)':'var(--text-muted)', borderBottom: isActive?'2px solid var(--accent-600)':'2px solid transparent', background: isActive?'var(--bg-active)':'transparent', fontWeight: isActive?700:400, borderRight:'1px solid var(--border-subtle)', transition:'color 150ms, background 150ms' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}><path d={tab.icon}/></svg>
              {tab.label}
              {tab.count && <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', minWidth:'13px', height:'12px', padding:'0 3px', background:'var(--accent-100)', border:'1px solid var(--accent-border)', borderRadius:'2px', fontSize:'8px', fontWeight:700, color:'var(--accent-700)' }}>{tab.count}</span>}
            </div>
          );
        })}
      </div>
      <div style={{ flex:1, overflowY:'auto', background:'var(--bg-surface)' }}>
        {content[active]}
      </div>
    </div>
  );
};

Object.assign(window, { RetrievalLifecycle });
