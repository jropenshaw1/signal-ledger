// Signal Ledger — Provider Bar (light theme, brand_tokens.css)
// Burnt sienna accent, warm parchment backgrounds, clickable gap window popover

const GAP_DATA = {
  status: 'acknowledged', label: 'Feb 12–21',
  gap_start: '2026-02-12', gap_end: '2026-02-21',
  article_count_estimated: 10,
  resolution_path: 'email-backfill',
  resolution_notes: "Articles from Jonathan's subscription start before MCP index began. Sourcing from Gmail archive via email-backfill path.",
};

const STATUS_LIFECYCLE = ['open','acknowledged','resolved','unresolvable'];

const GapPopover = ({ gap, onClose }) => {
  const resPathColor = { 'web':'var(--accent-600)', 'email-backfill':'var(--info-700)', 'none':'var(--text-muted)' };
  const stepStyle = (s) => {
    const idx = STATUS_LIFECYCLE.indexOf(gap.status);
    const myIdx = STATUS_LIFECYCLE.indexOf(s);
    if (s === gap.status) return { background:'var(--accent-100)', color:'var(--accent-700)', border:'1px solid var(--accent-border)', fontWeight:700 };
    if (myIdx < idx) return { background:'var(--bg-inset)', color:'var(--text-disabled)', border:'1px solid var(--border-subtle)' };
    return { background:'transparent', color:'var(--text-disabled)', border:'1px solid var(--border-subtle)' };
  };
  return (
    <div style={{ position:'absolute', top:'30px', left:0, zIndex:300, background:'var(--bg-elevated)', border:'1px solid var(--border-elevated)', borderRadius:'4px', width:'310px', boxShadow:'0 4px 12px rgba(44,26,8,0.14)', fontFamily:"'JetBrains Mono',monospace" }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 11px', borderBottom:'1px solid var(--border-default)', background:'var(--bg-header)' }}>
        <span style={{ fontFamily:"'Inter',sans-serif", fontSize:'11px', fontWeight:700, color:'var(--text-heading)' }}>Gap Window</span>
        <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:'14px', lineHeight:1, padding:'0 2px' }}>×</button>
      </div>
      <div style={{ padding:'10px 12px' }}>
        {[['gap_start',gap.gap_start,'var(--text-secondary)'],['gap_end',gap.gap_end,'var(--text-secondary)'],['article_count_estimated',`~${gap.article_count_estimated}`,'var(--text-secondary)'],['resolution_path',gap.resolution_path,resPathColor[gap.resolution_path]||'var(--text-secondary)']].map(([label,value,color])=>(
          <div key={label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'4px 0', borderBottom:'1px solid var(--border-subtle)' }}>
            <span style={{ fontSize:'9px', color:'var(--text-muted)', letterSpacing:'0.04em' }}>{label}</span>
            <span style={{ fontSize:'10px', fontWeight:500, color }}>{value}</span>
          </div>
        ))}
        {gap.resolution_notes && (
          <div style={{ marginTop:'8px', padding:'6px 8px', background:'var(--bg-inset)', border:'1px solid var(--border-default)', borderRadius:'2px' }}>
            <div style={{ fontSize:'8px', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'3px' }}>resolution_notes</div>
            <div style={{ fontFamily:"'Inter',sans-serif", fontSize:'10px', color:'var(--text-secondary)', lineHeight:1.55 }}>{gap.resolution_notes}</div>
          </div>
        )}
        <div style={{ marginTop:'10px' }}>
          <div style={{ fontSize:'8px', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'5px' }}>resolution_status lifecycle</div>
          <div style={{ display:'flex', alignItems:'center', gap:'4px', flexWrap:'wrap' }}>
            {STATUS_LIFECYCLE.map((s,i)=>(
              <React.Fragment key={s}>
                <span style={{ padding:'2px 6px', borderRadius:'2px', fontSize:'9px', fontWeight:500, ...stepStyle(s) }}>{s}</span>
                {i < STATUS_LIFECYCLE.length-1 && <span style={{ fontSize:'9px', color:'var(--text-disabled)' }}>→</span>}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const ProviderBar = ({ provider = {} }) => {
  const [gapOpen, setGapOpen] = React.useState(false);
  const gapRef = React.useRef(null);
  React.useEffect(() => {
    if (!gapOpen) return;
    const h = (e) => { if (gapRef.current && !gapRef.current.contains(e.target)) setGapOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [gapOpen]);

  const { name='Nate B. Jones', platform='Substack', url='natesnewsletter.substack.com', tier='paid', corpusStart='2026-02-12', articleCount=47, lastIngestion='2026-05-02', gapWindow=GAP_DATA, evaluation='maintain-current-tier' } = provider;

  const tierBadge = tier==='paid'
    ? { bg:'var(--success-100)', color:'var(--success-900)', border:'1px solid var(--success-500)' }
    : { bg:'var(--bg-inset)', color:'var(--text-secondary)', border:'1px solid var(--border-default)' };

  const gapBadge = {
    open:         { bg:'var(--warning-100)', color:'var(--warning-900)', border:'1px solid var(--warning-600)', symbol:'▲' },
    acknowledged: { bg:'var(--accent-100)',  color:'var(--accent-700)',  border:'1px solid var(--accent-border)', symbol:'◎' },
    resolved:     { bg:'var(--success-100)', color:'var(--success-900)', border:'1px solid var(--success-500)', symbol:'✓' },
    unresolvable: { bg:'var(--bg-inset)',    color:'var(--text-muted)',   border:'1px solid var(--border-default)', symbol:'—' },
  }[gapWindow?.status] || {};

  const evalBadge = {
    'maintain-current-tier': { color:'var(--text-secondary)', border:'1px solid var(--border-default)', bg:'var(--bg-inset)' },
    'upgrade-candidate':     { color:'var(--success-900)', border:'1px solid var(--success-500)', bg:'var(--success-100)' },
    'degradation-signal':    { color:'var(--warning-900)', border:'1px solid var(--warning-600)', bg:'var(--warning-100)' },
    'abandon-signal':        { color:'var(--danger-900)', border:'1px solid var(--danger-600)', bg:'var(--danger-100)' },
  }[evaluation] || {};

  const pill = (children, style) => (
    <span style={{ display:'inline-flex', alignItems:'center', padding:'2px 7px', borderRadius:'2px', fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', fontWeight:700, whiteSpace:'nowrap', ...style }}>{children}</span>
  );
  const metaItem = (label, content, last=false) => (
    <div style={{ display:'flex', flexDirection:'column', gap:'2px', padding:'0 12px', borderRight: last ? 'none' : '1px solid var(--border-subtle)' }}>
      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em' }}>{label}</div>
      <div style={{ display:'flex', alignItems:'center' }}>{content}</div>
    </div>
  );

  return (
    <div style={{ display:'flex', alignItems:'center', height:'56px', background:'var(--bg-header)', borderBottom:'1px solid var(--border-elevated)', padding:'0 16px', flexShrink:0, position:'relative', zIndex:10 }}>
      {/* Identity */}
      <div style={{ display:'flex', alignItems:'center', gap:'10px', paddingRight:'18px', borderRight:'1px solid var(--border-default)', marginRight:'18px', flexShrink:0 }}>
        <div style={{ width:'32px', height:'32px', borderRadius:'4px', background:'var(--accent-600)', border:'1px solid var(--accent-700)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'11px', fontWeight:700, color:'var(--text-inverse)' }}>NJ</span>
        </div>
        <div>
          <div style={{ fontFamily:"'Inter',sans-serif", fontSize:'14px', fontWeight:700, color:'var(--text-heading)' }}>{name}</div>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:'var(--text-muted)', marginTop:'1px' }}>{platform} · {url}</div>
        </div>
      </div>
      {/* Meta */}
      <div style={{ display:'flex', alignItems:'center', flex:1 }}>
        {metaItem('Tier', pill(`${tier==='paid'?'● ':'○ '}${tier}`, { background:tierBadge.bg, color:tierBadge.color, border:tierBadge.border }))}
        {metaItem('Corpus Start', <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'12px', fontWeight:500, color:'var(--text-secondary)' }}>{corpusStart}</span>)}
        {metaItem('Articles', <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'18px', fontWeight:700, color:'var(--text-heading)' }}>{articleCount}</span>)}
        {metaItem('Last Ingestion', <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'12px', fontWeight:500, color:'var(--text-secondary)' }}>{lastIngestion}</span>)}
        {metaItem('Gap Window',
          <div ref={gapRef} style={{ position:'relative' }}>
            <span onClick={()=>setGapOpen(o=>!o)} style={{ display:'inline-flex', alignItems:'center', padding:'2px 7px', borderRadius:'2px', fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', fontWeight:700, whiteSpace:'nowrap', background:gapBadge.bg, color:gapBadge.color, border:gapBadge.border, cursor:'pointer', userSelect:'none' }}>
              {gapBadge.symbol} {gapWindow.label} · {gapWindow.status}
            </span>
            {gapOpen && <GapPopover gap={gapWindow} onClose={()=>setGapOpen(false)} />}
          </div>
        )}
        {metaItem('Last Evaluation', pill(evaluation, { background:evalBadge.bg, color:evalBadge.color, border:evalBadge.border }), true)}
      </div>
    </div>
  );
};

Object.assign(window, { ProviderBar });
