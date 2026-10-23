import { useRef } from 'react'
import { ArrowDownRight } from 'lucide-react'
import useTechPageMotion from '../hooks/useTechPageMotion'
import '../styles/tech-page-frame.css'

const SECTION_WORDS = { daily: 'DAILY', weekly: 'WEEKLY', topics: 'EXPLORE', series: 'COLLECT', reading: 'READ' }

/** A channel has its own composition; its visual slot contains real content. */
export default function TechPageFrame({ section, index, title, accentTitle, description, meta, actions, visual, children }) {
  const root = useRef(null)
  useTechPageMotion(root)
  return <div ref={root} className={`tech-page-frame tech-page-frame--${section}`} data-tech-page={section}>
    <div className="tech-page-atmosphere" aria-hidden="true"><div className="tech-page-hero__word">{SECTION_WORDS[section] || 'OBSERVER'}</div></div>
    <header className={`tech-page-hero${visual ? '' : ' tech-page-hero--text'}`}>
      <div className="tech-page-hero__copy">
        <div className="tech-page-eyebrow"><span aria-hidden="true" className="tech-page-beacon" />{index || 'AI / OBSERVER'}<span className="tech-page-eyebrow__line" /></div>
        <h1>{title}</h1>
        {accentTitle ? <p className="tech-page-hero__accent">{accentTitle}</p> : null}
        {description ? <p className="tech-page-hero__description">{description}</p> : null}
        {meta ? <div className="tech-page-hero__meta">{meta}</div> : null}
        {actions ? <div className="tech-page-hero__actions">{actions}</div> : null}
      </div>
      {visual ? <div className="tech-page-hero__visual"><div className="tech-page-visual__plane">{visual}</div><span className="tech-page-visual__coordinate" aria-hidden="true"><ArrowDownRight size={16} /> AI OBSERVER / {SECTION_WORDS[section]}</span></div> : null}
    </header>
    <div className="tech-page-content">{children}</div>
  </div>
}
