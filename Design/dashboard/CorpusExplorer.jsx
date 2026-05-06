// Signal Ledger — Corpus Explorer (light theme, brand_tokens.css)

const ARTICLES = [
  { id:'a3f2c1d0', title:'The Orchestration Problem: How Multi-Agent Systems Break', published:'2026-04-17', contentType:'Nate-feature-article', completeness:'complete', embeddingStatus:'complete', kitCount:3,
    signposts:['"The key insight here is that trust between agents is not symmetric…"','"What I\'m watching for in Q2: whether orchestration failures cluster around…"'],
    claims:[{ text:'Gartner projects 80% of enterprise AI deployments will include multi-agent coordination by 2027.', attribution:'Gartner', type:'statistic' }],
    blocks:[{ name:'Trust Gradient Model', type:'framework', kitCandidate:true }] },
  { id:'b7e1d4f2', title:'Executive Brief: AI Infrastructure Spend — Week of Apr 14', published:'2026-04-14', contentType:'Nate-executive-briefing', completeness:'preview-only', embeddingStatus:null, kitCount:0, signposts:[], claims:[], blocks:[] },
  { id:'c9d2e5f3', title:'Credential vs. Capability: What Agents Actually Trade', published:'2026-03-28', contentType:'Nate-feature-article', completeness:'partial', embeddingStatus:'pending', kitCount:1,
    signposts:['"The credential economy is not about proof of work — it is about proof of trustworthiness…"'],
    claims:[], blocks:[{ name:'Credential Ladder', type:'taxonomy', kitCandidate:false }] },
  { id:'d1e3f4a5', title:'Prompt Engineering Is Dead. Long Live Prompt Architecture.', published:'2026-03-14', contentType:'Nate-feature-article', completeness:'complete', embeddingStatus:'processing', kitCount:2,
    signposts:['"The contrarian take: prompt templates are the new if-statements…"'],
    claims:[{ text:'OpenAI internal data shows 60% of GPT-4 failures trace to prompt structure.', attribution:'OpenAI (reported)', type:'statistic' }],
    blocks:[{ name:'Prompt Architecture Taxonomy', type:'taxonomy', kitCandidate:true }] },
];

const COMPLETENESS = {
  complete:     { sym:'●', bg:'var(--success-100)', color:'var(--success-900)', border:'var(--success-500)', embColor:'var(--success-700)' },
  'preview-only':{ sym:'◐', bg:'var(--info-100)',    color:'var(--info-900)',    border:'var(--info-600)',    embColor:'var(--text-disabled)' },
  partial:      { sym:'◑', bg:'var(--warning-100)', color:'var(--warning-900)', border:'var(--warning-600)', embColor:'var(--warning-700)' },
};

const CT = {
  'Nate-feature-article':    { bg:'var(--accent-100)', color:'var(--accent-700)', border:'var(--accent-border)', short:'feature' },
  'Nate-executive-briefing': { bg:'var(--info-100)',   color:'var(--info-700)',   border:'var(--info-600)',      short:'executive' },
};

const PulsingDot = () => {
  const [op, setOp] = React.useState(1);
  React.useEffect(()=>{ let d=-1; const iv=setInterval(()=>setOp(o=>{const n=o+d*0.04;if(n<=0.3)d=1;if(n>=1)d=-1;return n;}),50); return()=>clearInterval(iv); },[]);
  return <span style={{ display:'inline-block', width:'6px', height:'6px', background:'var(--accent-500)', borderRadius:'50%', opacity:op }} />;
};

const EmbStatus = ({ status, completeness }) => {
  if (completeness==='preview-only') return <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--text-disabled)' }}>— n/a</span>;
  if (status==='processing') return <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--accent-600)', display:'flex', alignItems:'center', gap:'3px' }}><PulsingDot/> proc.</span>;
  const map = { complete:'var(--success-700)', pending:'var(--text-muted)', failed:'var(--danger-700)' };
  const sym = { complete:'●', pending:'○', failed:'✕' };
  return <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:map[status]||'var(--text-muted)' }}>{sym[status]||'—'} {status||'—'}</span>;
};

const ExpandedRow = ({ article }) => (
  <div style={{ background:'var(--bg-inset)', borderTop:'1px solid var(--border-subtle)', borderBottom:'1px solid var(--border-default)', padding:'10px 16px 12px 32px' }}>
    {article.signposts.length>0 && <>
      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'8px', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'4px' }}>Author Signposts</div>
      {article.signposts.map((s,i)=><div key={i} style={{ fontFamily:"'Inter',sans-serif", fontStyle:'italic', fontSize:'11px', color:'var(--text-secondary)', borderLeft:'2px solid var(--border-elevated)', paddingLeft:'8px', marginBottom:'3px', lineHeight:1.45 }}>{s}</div>)}
    </>}
    {article.claims.length>0 && <>
      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'8px', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em', margin:'8px 0 4px' }}>Cited Claims ({article.claims.length})</div>
      {article.claims.map((c,i)=>(
        <div key={i} style={{ fontFamily:"'Inter',sans-serif", fontSize:'11px', color:'var(--text-primary)', padding:'4px 8px', background:'var(--bg-elevated)', border:'1px solid var(--border-default)', borderRadius:'2px', marginBottom:'3px', lineHeight:1.4 }}>
          {c.text}
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--text-muted)', marginTop:'2px' }}>attributed_to: {c.attribution} · claim_type: {c.type} · {article.published}</div>
        </div>
      ))}
    </>}
    {article.blocks.length>0 && <>
      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'8px', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em', margin:'8px 0 4px' }}>Structured Technical Content ({article.blocks.length})</div>
      {article.blocks.map((b,i)=><div key={i} style={{ fontFamily:"'Inter',sans-serif", fontSize:'11px', color:'var(--info-700)', padding:'4px 8px', background:'var(--info-100)', border:'1px solid var(--info-600)', borderRadius:'2px', marginBottom:'3px', lineHeight:1.4 }}>{b.name} — {b.type} · kit_candidate: {b.kitCandidate?'true':'false'}</div>)}
    </>}
    {article.completeness==='preview-only' && <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:'var(--text-muted)', padding:'4px 0' }}>◐ preview-only — source did not provide full content (source-not-provided · Charter P9)</div>}
  </div>
);

const CorpusExplorer = ({ articles = ARTICLES }) => {
  const [expanded, setExpanded] = React.useState('a3f2c1d0');
  const [filterType, setFilterType] = React.useState('all');
  const [filterComp, setFilterComp] = React.useState('all');

  const filtered = articles.filter(a=>{
    if (filterType!=='all' && a.contentType!==filterType) return false;
    if (filterComp!=='all' && a.completeness!==filterComp) return false;
    return true;
  });

  const sel = { background:'var(--bg-active)', borderLeft:'2px solid var(--border-focus)', paddingLeft:'10px' };
  const unsel = { background:'transparent', borderLeft:'2px solid transparent' };

  return (
    <div style={{ display:'flex', flexDirection:'column', background:'var(--bg-surface)', border:'1px solid var(--border-default)', flex:1, minWidth:0, overflow:'hidden' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderBottom:'1px solid var(--border-default)', background:'var(--bg-header)', flexShrink:0 }}>
        <span style={{ fontFamily:"'Inter',sans-serif", fontSize:'12px', fontWeight:700, color:'var(--text-heading)' }}>Corpus Explorer</span>
        <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
          {[['filterType',[['all','all types'],['Nate-feature-article','feature'],['Nate-executive-briefing','executive']],filterType,setFilterType],['filterComp',[['all','all completeness'],['complete','complete'],['preview-only','preview-only'],['partial','partial']],filterComp,setFilterComp]].map(([key,opts,val,set])=>(
            <select key={key} value={val} onChange={e=>set(e.target.value)} style={{ height:'24px', padding:'0 6px', background:'var(--bg-elevated)', border:'1px solid var(--border-default)', borderRadius:'4px', fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:'var(--text-secondary)', outline:'none', cursor:'pointer' }}>
              {opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          ))}
          <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--text-muted)' }}>{filtered.length} articles</span>
        </div>
      </div>
      {/* Col headers */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 88px 82px 98px 72px 36px', gap:'8px', padding:'4px 12px', borderBottom:'1px solid var(--border-default)', background:'var(--bg-inset)', flexShrink:0 }}>
        {['Title','Published','Type','Completeness','Embedding','Kits'].map((h,i)=>(
          <div key={h} style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'8px', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', textAlign: i===5?'right':'left' }}>{h}</div>
        ))}
      </div>
      {/* Rows */}
      <div style={{ flex:1, overflowY:'auto' }}>
        {filtered.map(article=>{
          const isOpen = expanded===article.id;
          const cp = COMPLETENESS[article.completeness];
          const ct = CT[article.contentType];
          return (
            <React.Fragment key={article.id}>
              <div onClick={()=>setExpanded(isOpen?null:article.id)} style={{ display:'grid', gridTemplateColumns:'1fr 88px 82px 98px 72px 36px', gap:'8px', alignItems:'center', padding:'0 10px', height:'36px', borderBottom:'1px solid var(--border-subtle)', cursor:'pointer', transition:'background 150ms', ...(isOpen?sel:unsel) }}>
                <div style={{ display:'flex', alignItems:'center', gap:'6px', minWidth:0 }}>
                  <span style={{ fontSize:'9px', color:isOpen?'var(--accent-600)':'var(--text-muted)', transform:isOpen?'rotate(90deg)':'none', display:'inline-block', transition:'transform 150ms', flexShrink:0 }}>▶</span>
                  <span style={{ fontFamily:"'Inter',sans-serif", fontSize:'12px', color:'var(--text-primary)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{article.title}</span>
                </div>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:'var(--text-muted)' }}>{article.published}</span>
                <span style={{ display:'inline-flex', padding:'1px 5px', borderRadius:'2px', background:ct?.bg, color:ct?.color, border:`1px solid ${ct?.border}`, fontFamily:"'JetBrains Mono',monospace", fontSize:'8px', fontWeight:700 }}>{ct?.short}</span>
                <span style={{ display:'inline-flex', alignItems:'center', gap:'3px', padding:'1px 5px', borderRadius:'2px', background:cp?.bg, color:cp?.color, border:`1px solid ${cp?.border}`, fontFamily:"'JetBrains Mono',monospace", fontSize:'8px', fontWeight:700 }}>{cp?.sym} {article.completeness}</span>
                <EmbStatus status={article.embeddingStatus} completeness={article.completeness} />
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:article.kitCount>0?'var(--text-secondary)':'var(--text-disabled)', textAlign:'right' }}>{article.kitCount>0?article.kitCount:'—'}</span>
              </div>
              {isOpen && <ExpandedRow article={article} />}
            </React.Fragment>
          );
        })}
      </div>
      {/* Footer */}
      <div style={{ display:'flex', gap:'14px', padding:'6px 12px', borderTop:'1px solid var(--border-default)', background:'var(--bg-inset)', flexShrink:0 }}>
        {[['complete','var(--success-600)','●'],['preview-only','var(--info-600)','◐'],['partial','var(--warning-600)','◑']].map(([c,col,sym])=>(
          <span key={c} style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--text-muted)', display:'flex', alignItems:'center', gap:'3px' }}>
            <span style={{color:col}}>{sym}</span> {articles.filter(a=>a.completeness===c).length} {c}
          </span>
        ))}
      </div>
    </div>
  );
};

Object.assign(window, { CorpusExplorer });
