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
    {type === 'models' ? <g><ellipse cx="150" cy="77" rx="82" ry="33" transform="rotate(-27 150 77)" /><ellipse cx="150" cy="77" rx="82" ry="33" transform="rotate(27 150 77)" /><ellipse cx="150" cy="77" rx="32" ry="66" /><circle cx="150" cy="77" r="14" /><circle cx="213" cy="44" r="4" className="topic-art__point" /></g> : type === 'tools' ? <g><path d="M101 43L67 76L101 109M199 43L233 76L199 109M167 28L136 122" /><rect x="44" y="16" width="212" height="120" rx="12" className="topic-art__fine" /><path d="M44 40H256M57 28H75" className="topic-art__fine" /></g> : <g><path d="M150 20L225 61L150 102L75 61Z M75 80L150 121L225 80M75 99L150 140L225 99" /><path d="M150 20V102M75 61L150 102L225 61" className="topic-art__fine" /><path d="M150 47L177 62L150 77L123 62Z" className="topic-art__point" /></g>}
  </svg>
}

export default function TechTopicExplorer() {
  return <section className="tech-topics" aria-labelledby="tech-topics-title">
    <div className="tech-topics__sculpture" aria-hidden="true"><img src="/images/intelligence-edition/floating-ribbon.png" alt="" width="1536" height="1024" loading="lazy" /></div>
    <header><div><span>III / EXPLORE THE POSSIBILITIES</span><h2 id="tech-topics-title"><span className="edition-title-line"><span>沿着一个领域，</span></span><span className="edition-title-line"><span>继续看下去。</span></span><span className="edition-title-line"><span><em>Ideas in motion.</em></span></span></h2></div><Link to="/topics">全部主题 <ArrowUpRight size={17} aria-hidden="true" /></Link></header>
    <div className="tech-topics__grid">{BEATS.map((beat) => <Link key={beat.art} className={`tech-topic tech-topic--${beat.art}`} to={`/search?q=${encodeURIComponent(beat.query)}`}>
      <div className="tech-topic__art"><div className="tech-topic__motion-art"><TopicArt type={beat.art} /></div><small>{beat.label}</small></div>
      <div className="tech-topic__body"><h3>{beat.title}<ArrowUpRight size={20} aria-hidden="true" /></h3><p>{beat.description}</p><span>按关键词浏览已发布内容</span></div>
    </Link>)}</div>
  </section>
}
