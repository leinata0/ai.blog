import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import '../../styles/news-tech-topics.css'

const BEATS = [
  { title: '模型与产品', query: '模型', label: 'MODELS & PRODUCTS', description: '从模型进展到产品发布，理解能力如何变成体验。', art: 'models' },
  { title: '开源与工具', query: '开源', label: 'OPEN SOURCE & TOOLS', description: '关注开发者生态，寻找值得继续追踪的工具与项目。', art: 'tools' },
  { title: '算力与产业', query: '算力', label: 'COMPUTE & INDUSTRY', description: '看技术背后的芯片、基础设施与产业变化。', art: 'compute' },
]

function TopicArt({ type }) {
  return <svg viewBox="0 0 300 150" fill="none" aria-hidden="true">
    {type === 'models' ? <g>
      <path d="M72 42L150 27L228 42M72 75H228M72 108L150 123L228 108M72 42L150 75L228 42M72 108L150 75L228 108M72 75L150 27L228 75L150 123Z" className="topic-art__fine" />
      {[72, 150, 228].map((x) => [42, 75, 108].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r={x === 150 && y === 75 ? 12 : 5} className="topic-art__point" />))}
      <circle cx="150" cy="75" r="39" strokeDasharray="3 7" />
    </g> : type === 'tools' ? <g>
      <rect x="62" y="28" width="176" height="99" rx="7" className="topic-art__fine" />
      <path d="M62 49H238M76 39H102M111 67L95 83L111 99M189 67L205 83L189 99M165 61L140 106M38 77H62M238 77H263" />
      <circle cx="33" cy="77" r="5" className="topic-art__point" /><circle cx="268" cy="77" r="5" className="topic-art__point" />
    </g> : <g>
      <rect x="104" y="34" width="92" height="84" rx="6" /><rect x="120" y="50" width="60" height="52" rx="3" className="topic-art__fine" />
      {[117, 139, 161, 183].map((x) => <path key={x} d={`M${x} 20V34M${x} 118V133`} />)}
      {[48, 67, 86, 105].map((y) => <path key={y} d={`M87 ${y}H104M196 ${y}H213`} />)}
      <path d="M137 65H163V88H137Z" className="topic-art__point" /><path d="M56 37H75V119H56M226 37H245V119H226" className="topic-art__fine" />
    </g>}
  </svg>
}

function SignalField() {
  return <svg viewBox="0 0 420 320" fill="none" aria-hidden="true">
    <circle cx="210" cy="160" r="118" /><circle cx="210" cy="160" r="82" strokeDasharray="3 10" /><circle cx="210" cy="160" r="35" />
    <ellipse cx="210" cy="160" rx="184" ry="67" transform="rotate(-32 210 160)" />
    <path d="M15 160H405M210 12V308M107 100L210 160L323 101M107 224L210 160L323 224M107 100V224M323 101V224" />
    {[[107, 100], [107, 224], [323, 101], [323, 224], [210, 42], [210, 278]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="5" className="signal-field__node" />)}
    <circle cx="210" cy="160" r="9" className="signal-field__core" />
  </svg>
}

export default function TechTopicExplorer() {
  return <section className="tech-topics" aria-labelledby="tech-topics-title">
    <div className="tech-topics__sculpture" aria-hidden="true"><SignalField /></div>
    <header><div><span>III / SIGNAL DOMAINS</span><h2 id="tech-topics-title"><span className="edition-title-line"><span>沿着一个领域，</span></span><span className="edition-title-line"><span>继续看下去。</span></span><span className="edition-title-line"><span><em>FOLLOW THE SIGNAL.</em></span></span></h2></div><Link to="/topics">全部主题 <ArrowUpRight size={17} aria-hidden="true" /></Link></header>
    <div className="tech-topics__grid">{BEATS.map((beat) => <Link key={beat.art} className={`tech-topic tech-topic--${beat.art}`} to={`/search?q=${encodeURIComponent(beat.query)}`}>
      <div className="tech-topic__art"><div className="tech-topic__motion-art"><TopicArt type={beat.art} /></div><small>{beat.label}</small></div>
      <div className="tech-topic__body"><h3>{beat.title}<ArrowUpRight size={20} aria-hidden="true" /></h3><p>{beat.description}</p><span>按关键词浏览已发布内容</span></div>
    </Link>)}</div>
  </section>
}
