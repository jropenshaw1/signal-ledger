// Signal Ledger — Ingestion Monitor (light theme, brand_tokens.css)
// Live event feed with retry chain visualization

const SAMPLE_EVENTS = [
  { id:'e1',  type:'ingestion_started',   status:'neutral',  time:'14:32:01', detail:'The Orchestration Problem — Nate B. Jones' },
  { id:'e2',  type:'ingestion_succeeded', status:'success',  time:'14:32:03', detail:'a3f2c1d0… · complete' },
  { id:'e3',  type:'embedding_queued',    status:'neutral',  time:'14:32:03', detail:'a3f2c1d0… · pending' },
  { id:'e4',  type:'embedding_succeeded', status:'success',  time:'14:32:07', detail:'a3f2c1d0… · complete' },
  { id:'e5',  type:'ingestion_started',   status:'neutral',  time:'14:33:10', detail:'Credential vs. Capability — Nate B. Jones' },
  { id:'e6',  type:'ingestion_succeeded', status:'success',  time:'14:33:12', detail:'b7e1d4f2… · partial' },
  { id:'e7',  type:'embedding_failed',    status:'failed',   time:'14:33:12', detail:'RATE_LIMITED · retryable · attempt 1/3', errorCode:'RATE_LIMITED', retryable:true },
  { id:'e8',  type:'retry_attempted',     status:'retry',    time:'14:33:14', detail:'retry_of: evt_a1… · wait 2s' },
  { id:'e9',  type:'embedding_failed',    status:'failed',   time:'14:33:14', detail:'RATE_LIMITED · retryable · attempt 2/3', retryable:true },
  { id:'e10', type:'retry_attempted',     status:'retry',    time:'14:33:22', detail:'retry_of: evt_d4… · wait 8s' },
  { id:'e11', type:'embedding_failed',    status:'terminal', time:'14:33:22', detail:'RATE_LIMITED · attempt 3/3 · TERMINAL', retryable:false, terminal:true },
  { id:'e12', type:'ingestion_failed',    status:'failed',   time:'14:34:01', detail:'DUPLICATE_ARTICLE · retryable: false' },
];

const DOT = {
  neutral:  { sym:'○', color:'var(--text-disabled)' },
  success:  { sym:'●', color:'var(--success-600)' },
  failed:   { sym:'✕', color:'var(--danger-600)' },
  terminal: { sym:'✕', color:'var(--danger-700)' },
  retry:    { sym:'↺', color:'var(--warning-600)' },
};

const TYPE_COLOR = {
  ingestion_started:   'var(--text-muted)',
  ingestion_succeeded: 'var(--success-700)',
  ingestion_failed:    'var(--danger-700)',
  embedding_queued:    'var(--text-muted)',
  embedding_succeeded: 'var(--success-700)',
  embedding_failed:    'var(--danger-700)',
  retry_attempted:     'var(--warning-700)',
};

const ROW_BG = {
  failed:   'rgba(185,28,28,0.05)',
  terminal: 'rgba(185,28,28,0.09)',
  retry:    'rgba(146,64,14,0.05)',
};

const IngestionMonitor = ({ events = SAMPLE_EVENTS }) => {
  const [selected, setSelected] = React.useState(null);
  const succeeded = events.filter(e=>e.status==='success').length;
  const failed = events.filter(e=>e.status==='failed'||e.status==='terminal').length;
  const retries = events.filter(e=>e.status==='retry').length;

  return (
    <div style={{ display:'flex', flexDirection:'column', background:'var(--bg-surface)', border:'1px solid var(--border-default)', width:'240px', flexShrink:0, overflow:'hidden' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderBottom:'1px solid var(--border-default)', background:'var(--bg-header)', flexShrink:0 }}>
        <span style={{ fontFamily:"'Inter',sans-serif", fontSize:'12px', fontWeight:700, color:'var(--text-heading)' }}>Ingestion Monitor</span>
        <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--text-muted)' }}>live</span>
      </div>
      {/* Col headers */}
      <div style={{ display:'grid', gridTemplateColumns:'14px 110px 1fr 50px', gap:'6px', padding:'3px 10px', borderBottom:'1px solid var(--border-default)', background:'var(--bg-inset)', flexShrink:0 }}>
        {['','Event','Detail','Time'].map((h,i)=>(
          <div key={i} style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'8px', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</div>
        ))}
      </div>
      {/* Rows */}
      <div style={{ flex:1, overflowY:'auto' }}>
        {events.map(ev=>{
          const dot = DOT[ev.status]||DOT.neutral;
          const isSelected = selected===ev.id;
          return (
            <div key={ev.id} onClick={()=>setSelected(isSelected?null:ev.id)} style={{ display:'grid', gridTemplateColumns:'14px 110px 1fr 50px', gap:'6px', alignItems:'center', padding:'5px 10px', borderBottom:'1px solid var(--border-subtle)', cursor:'pointer', transition:'background 150ms', minHeight:'28px', background: isSelected ? 'var(--bg-active)' : ROW_BG[ev.status]||'transparent', borderLeft: isSelected ? '2px solid var(--border-focus)' : '2px solid transparent' }}>
              <span style={{ fontSize:'9px', color:dot.color, textAlign:'center', lineHeight:1 }}>{dot.sym}</span>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', fontWeight:500, color:TYPE_COLOR[ev.type]||'var(--text-muted)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{ev.type}</span>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:ev.terminal?'var(--danger-700)':ev.status==='failed'?'var(--danger-600)':ev.status==='retry'?'var(--warning-700)':'var(--text-secondary)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                {ev.terminal ? <strong>{ev.detail}</strong> : ev.detail}
              </span>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--text-disabled)', textAlign:'right' }}>{ev.time}</span>
            </div>
          );
        })}
      </div>
      {/* Footer */}
      <div style={{ display:'flex', gap:'10px', padding:'5px 10px', borderTop:'1px solid var(--border-default)', background:'var(--bg-inset)', flexShrink:0 }}>
        <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--text-muted)', display:'flex', alignItems:'center', gap:'3px' }}><span style={{color:'var(--success-600)'}}>●</span> {succeeded}</span>
        <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--text-muted)', display:'flex', alignItems:'center', gap:'3px' }}><span style={{color:'var(--danger-600)'}}>✕</span> {failed}</span>
        <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', color:'var(--text-muted)', display:'flex', alignItems:'center', gap:'3px' }}><span style={{color:'var(--warning-600)'}}>↺</span> {retries}</span>
      </div>
    </div>
  );
};

Object.assign(window, { IngestionMonitor });
