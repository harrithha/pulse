import { useEffect, useRef, useState, type ReactNode } from 'react'
import { emptyEdition, loadEdition, prefetchStoryArticle, readCachedEdition } from './lib/news'
import { cleanArticleParagraphs } from './lib/articleText'
import { readPrefs, readSession, writePrefs } from './lib/session'
import { canSpeak, packScriptGroups, prefetchSpeech, speakSections, type SpeechHandle } from './lib/speech'
import type { NewsPayload, Screen, Session, StoryCard, Tab } from './types'

const CITIES = ['Pune', 'Mumbai', 'Bengaluru', 'Chennai', 'Hyderabad', 'Delhi', 'Kolkata', 'Ahmedabad']
const STATES = ['Maharashtra', 'Tamil Nadu', 'Karnataka', 'Telangana', 'Gujarat', 'Rajasthan']
const TOPICS = ['Technology', 'AI', 'Business', 'Startups', 'Sports', 'Entertainment', 'Science', 'Politics', 'Finance']

function dayGreeting(at = new Date()) {
  const hour = at.getHours()
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function liveBriefOpener(script: string) {
  if (!/^Good (morning|afternoon|evening)\b/i.test(script)) return script
  return `${dayGreeting()}. Here is today's Pulse.`
}

function findStory(edition: NewsPayload, id: string) {
  for (const shelf of edition.shelves) {
    const hit = shelf.stories.find(s => s.id === id)
    if (hit) return hit
  }
  return edition.highlights.find(s => s.id === id) || null
}

function pathFor(screen: Screen, storyId?: string) {
  if (screen === 'story' && storyId) return `/story/${encodeURIComponent(storyId)}`
  if (screen === 'profile') return '/profile'
  if (screen === 'onboarding-location') return '/setup/location'
  if (screen === 'onboarding-topics') return '/setup/topics'
  return '/'
}

function parsePath(pathname: string): { screen: Screen; storyId?: string } {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path.startsWith('/story/')) {
    const storyId = decodeURIComponent(path.slice('/story/'.length))
    return storyId ? { screen: 'story', storyId } : { screen: 'home' }
  }
  if (path === '/profile') return { screen: 'profile' }
  if (path === '/setup/location') return { screen: 'onboarding-location' }
  if (path === '/setup/topics') return { screen: 'onboarding-topics' }
  return { screen: 'home' }
}

function shelfTitle(label: string) {
  return label.replace(/^My City · /, '')
}

function sourceName(story: StoryCard) {
  const name = story.publishers.find(p => p.name && p.name !== 'Unknown')?.name
  return name || story.category
}

function sourceLinks(story: StoryCard) {
  const seen = new Set<string>()
  const links = story.publishers.filter(p => p.url && p.url !== '#')
  const out = links.filter(p => {
    if (seen.has(p.url)) return false
    seen.add(p.url)
    return true
  })
  if (!out.length && story.url) out.push({ name: story.category || 'Source', url: story.url })
  return out
}

function primaryReadUrl(story: StoryCard) {
  const google = /news\.google\.com/i
  const links = sourceLinks(story)
  return links.find(l => !google.test(l.url))?.url || links[0]?.url || story.url
}

function storyListenScripts(story: StoryCard, paragraphs: string[]) {
  const parts = [story.headline]
  if (paragraphs.length) parts.push(...paragraphs)
  else {
    parts.push(...(story.whatHappened.length ? story.whatHappened : [story.summary]))
    if (story.whyItMatters) parts.push(story.whyItMatters)
  }
  return parts.filter(p => p.trim()).map(script => ({ script }))
}

function orderedShelves(shelves: NewsPayload['shelves']) {
  const citySet = new Set(CITIES)
  const stateSet = new Set(STATES)
  const cities: NewsPayload['shelves'] = []
  const states: NewsPayload['shelves'] = []
  const topics: NewsPayload['shelves'] = []
  for (const shelf of shelves) {
    const title = shelfTitle(shelf.label)
    if (citySet.has(title)) cities.push(shelf)
    else if (stateSet.has(title)) states.push(shelf)
    else topics.push(shelf)
  }
  return [...cities, ...states, ...topics]
}

function NavChevron({ dir, size = 22 }: { dir: 'left' | 'right'; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path
        d={dir === 'left' ? 'M14.5 5.5 8 12l6.5 6.5' : 'M9.5 5.5 16 12l-6.5 6.5'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ChevronLeft() {
  return <NavChevron dir="left" size={18} />
}

function PlayIcon({ fill = 'currentColor' }: { fill?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={fill}>
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  )
}

function PauseIcon({ fill = 'currentColor' }: { fill?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={fill}>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  )
}

function ListenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10v4" />
      <path d="M7 7v10" />
      <path d="M11 4v16" />
      <path d="M15 7v10" />
      <path d="M19 10v4" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  )
}

function Tag({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 sm:px-4 py-2 rounded-full text-sm transition-all duration-150 min-h-10"
      style={
        active
          ? { background: '#EA580C', color: '#111111', fontWeight: 600 }
          : { background: '#17172A', color: '#B8B4AC', border: '1px solid rgba(255,255,255,0.08)' }
      }
    >
      {label}
    </button>
  )
}

function PulseMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden style={{ display: 'block', flexShrink: 0 }}>
      <rect width="32" height="32" rx="9" fill="#EA580C" />
      <path
        d="M4.8 16.5h5.6L12.4 7.4 16.8 24.6 19.4 16.5H25.6"
        stroke="#FFF7F2"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="26.6" cy="16.5" r="1.7" fill="#FFF7F2" />
    </svg>
  )
}

function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      <PulseMark size={size} />
      <span className="text-[11px] md:text-[12px] font-semibold tracking-[0.32em] md:tracking-[0.38em] uppercase" style={{ color: '#F5A623' }}>
        Pulse
      </span>
    </span>
  )
}

function todayLabel() {
  return new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
}

function SiteHeader({
  tab,
  onNavigate,
  onRefresh,
  refreshing,
}: {
  tab: Tab
  onNavigate: (next: Tab) => void
  onRefresh: () => void
  refreshing: boolean
}) {
  const editing = tab === 'profile'
  return (
    <header
      className="sticky top-0 z-50"
      style={{
        background: 'rgba(7,7,12,0.92)',
        backdropFilter: 'blur(18px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        paddingTop: 'env(safe-area-inset-top)',
      }}
    >
      <div className="px-4 sm:px-5 md:px-10 h-14 md:h-16 flex items-center gap-2 sm:gap-3">
        <button onClick={() => onNavigate('home')} className="shrink-0">
          <BrandMark size={24} />
        </button>
        <div className="ml-auto flex items-center gap-2 sm:gap-2.5">
          <button
            onClick={() => onNavigate('profile')}
            className="px-3 py-1.5 rounded-lg text-xs sm:text-sm min-h-9 whitespace-nowrap"
            style={{
              color: editing ? '#F5A623' : '#C4B9A8',
              border: editing ? '1px solid rgba(245,166,35,0.45)' : '1px solid rgba(255,255,255,0.1)',
              background: editing ? 'rgba(245,166,35,0.12)' : '#17172A',
              fontWeight: 600,
            }}
          >
            Edit topics
          </button>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="px-3 py-1.5 rounded-lg text-xs sm:text-sm min-h-9"
            style={{ color: '#F5A623', border: '1px solid rgba(245,166,35,0.35)', background: '#17172A', fontWeight: 600 }}
          >
            {refreshing ? 'Updating…' : 'Refresh'}
          </button>
        </div>
      </div>
    </header>
  )
}

function OnboardingLocation({
  selected,
  onToggle,
  onNext,
}: {
  selected: Set<string>
  onToggle: (s: string) => void
  onNext: () => void
}) {
  return (
    <div className="min-h-dvh" style={{ background: '#07070C' }}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <div className="mb-8 sm:mb-10">
          <BrandMark size={26} />
        </div>
        <h1 className="font-serif text-[#EEE8E0] text-[32px] sm:text-[42px] leading-tight mb-3">Where should we pull news from?</h1>
        <p className="text-sm sm:text-base mb-8 sm:mb-10" style={{ color: '#9B968F' }}>Pick the places that become your Home rows.</p>
        <div className="space-y-8 mb-10 sm:mb-12">
          <div>
            <div className="text-[10px] font-semibold tracking-[0.2em] uppercase mb-3" style={{ color: '#8A8AA0' }}>Cities</div>
            <div className="flex flex-wrap gap-2">{CITIES.map(c => <Tag key={c} label={c} active={selected.has(c)} onClick={() => onToggle(c)} />)}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold tracking-[0.2em] uppercase mb-3" style={{ color: '#8A8AA0' }}>States & regions</div>
            <div className="flex flex-wrap gap-2">{STATES.map(s => <Tag key={s} label={s} active={selected.has(s)} onClick={() => onToggle(s)} />)}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold tracking-[0.2em] uppercase mb-3" style={{ color: '#8A8AA0' }}>Broader coverage</div>
            <div className="flex flex-wrap gap-2">{['India', 'World'].map(g => <Tag key={g} label={g} active={selected.has(g)} onClick={() => onToggle(g)} />)}</div>
          </div>
        </div>
        <button
          onClick={onNext}
          disabled={selected.size === 0}
          className="w-full sm:w-auto px-8 py-4 rounded-xl text-base font-semibold min-h-12"
          style={{ background: '#EA580C', color: '#111111', opacity: selected.size === 0 ? 0.35 : 1 }}
        >
          Continue →
        </button>
      </div>
    </div>
  )
}

function OnboardingTopics({
  selected,
  onToggle,
  onDone,
}: {
  selected: Set<string>
  onToggle: (s: string) => void
  onDone: () => void
}) {
  return (
    <div className="min-h-dvh" style={{ background: '#07070C' }}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <div className="mb-8 sm:mb-10">
          <BrandMark size={26} />
        </div>
        <h1 className="font-serif text-[#EEE8E0] text-[32px] sm:text-[42px] leading-tight mb-3">Any extra topics?</h1>
        <p className="text-sm sm:text-base mb-8 sm:mb-10" style={{ color: '#9B968F' }}>These show up as extra rows under Pune, Maharashtra, India, and World.</p>
        <div className="flex flex-wrap gap-2 mb-6">
          {TOPICS.map(t => <Tag key={t} label={t} active={selected.has(t)} onClick={() => onToggle(t)} />)}
        </div>
        <button onClick={onDone} className="w-full sm:w-auto px-8 py-4 rounded-xl text-base font-semibold min-h-12" style={{ background: '#EA580C', color: '#111111' }}>
          Load today’s edition →
        </button>
      </div>
    </div>
  )
}

function PosterCard({
  story,
  onClick,
  onPrefetch,
  layout = 'rail',
}: {
  story: StoryCard
  onClick: () => void
  onPrefetch?: () => void
  layout?: 'rail' | 'grid'
}) {
  const rail = layout === 'rail'
  return (
    <button
      onClick={onClick}
      onPointerDown={onPrefetch}
      onFocus={onPrefetch}
      className={
        rail
          ? 'shrink-0 w-[78vw] max-w-[260px] sm:w-[240px] sm:max-w-none md:w-[280px] text-left rounded-xl overflow-hidden snap-start group'
          : 'w-full min-w-0 text-left rounded-xl overflow-hidden group'
      }
      style={{ background: '#141424', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div
        className={rail ? 'relative h-[140px] sm:h-[150px] md:h-[168px] overflow-hidden' : 'relative h-[150px] sm:h-[160px] overflow-hidden'}
        style={{ background: '#1A1A2C' }}
      >
        {story.image ? (
          <img
            src={story.image}
            alt=""
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div
            className="w-full h-full flex items-end p-4"
            style={{ background: 'linear-gradient(160deg, #2A1E10 0%, #141424 58%, #0E0E18 100%)' }}
          >
            <span className="text-xs font-medium" style={{ color: '#F5A623' }}>{sourceName(story)}</span>
          </div>
        )}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'linear-gradient(to top, rgba(7,7,12,0.75), transparent 55%)' }} />
      </div>
      <div className="p-3.5">
        <div className="text-[11px] mb-1.5 truncate font-semibold" style={{ color: '#F5A623' }}>{sourceName(story)} · {story.time}</div>
        <div className="text-[15px] font-medium leading-snug line-clamp-2" style={{ color: '#EEE8E0' }}>{story.headline}</div>
      </div>
    </button>
  )
}

function RowArrow({ dir, label, onClick }: { dir: 'left' | 'right'; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="nav-btn hidden sm:flex w-10 h-10 lg:w-11 lg:h-11 justify-self-center"
      style={{ background: '#17172A', color: '#EEE8E0', border: '1px solid rgba(255,255,255,0.12)' }}
      aria-label={label}
    >
      <NavChevron dir={dir} size={18} />
    </button>
  )
}

function ShelfRow({ title, stories, onOpen }: { title: string; stories: StoryCard[]; onOpen: (s: StoryCard) => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  const scrollBy = (dir: number) => {
    scroller.current?.scrollBy({ left: dir * Math.min(720, window.innerWidth * 0.72), behavior: 'smooth' })
  }
  if (!stories.length) return null
  return (
    <section className="mb-6 sm:mb-7">
      <div className="grid grid-cols-1 sm:grid-cols-[44px_minmax(0,1fr)_44px] lg:grid-cols-[52px_minmax(0,1fr)_52px] px-1 sm:px-2 md:px-3 mb-2 sm:mb-2.5">
        <div className="hidden sm:block" />
        <h2 className="px-3 sm:px-1 text-[18px] sm:text-[20px] md:text-[22px] font-semibold tracking-tight" style={{ color: '#EEE8E0' }}>
          {title}
        </h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[44px_minmax(0,1fr)_44px] lg:grid-cols-[52px_minmax(0,1fr)_52px] items-center px-1 sm:px-2 md:px-3">
        <RowArrow dir="left" label={`Scroll ${title} left`} onClick={() => scrollBy(-1)} />
        <div ref={scroller} className="row-scroll min-w-0 px-3 sm:px-1">
          {stories.map(story => (
            <PosterCard
              key={story.id}
              story={story}
              onClick={() => onOpen(story)}
              onPrefetch={() => { void prefetchStoryArticle(story) }}
            />
          ))}
        </div>
        <RowArrow dir="right" label={`Scroll ${title} right`} onClick={() => scrollBy(1)} />
      </div>
    </section>
  )
}

function searchStories(edition: NewsPayload, query: string, topic: string) {
  const q = query.trim().toLowerCase()
  return orderedShelves(edition.shelves)
    .filter(s => topic === 'All' || shelfTitle(s.label) === topic)
    .flatMap(s => s.stories)
    .filter(s => !q || `${s.headline} ${s.summary} ${s.category} ${s.shelf} ${sourceName(s)}`.toLowerCase().includes(q))
}

function HomePage({
  edition,
  loading,
  error,
  onRetry,
  onStoryTap,
}: {
  edition: NewsPayload
  loading: boolean
  error: string | null
  onRetry: () => void
  onStoryTap: (s: StoryCard) => void
}) {
  const [audioOn, setAudioOn] = useState(false)
  const [audioBusy, setAudioBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [topic, setTopic] = useState('All')
  const speech = useRef<SpeechHandle | null>(null)
  const rows = orderedShelves(edition.shelves)
  const labels = ['All', ...rows.map(s => shelfTitle(s.label))]
  const searching = Boolean(query.trim()) || topic !== 'All'
  const results = searching ? searchStories(edition, query, topic) : []

  useEffect(() => () => speech.current?.stop(), [])
  useEffect(() => {
    const scripts = edition.brief.sections
      .map((s, i) => {
        const script = s.script.replace(/\s+/g, ' ').trim()
        return i === 0 ? liveBriefOpener(script) : script
      })
      .filter(Boolean)
    const packed = packScriptGroups(scripts)
    packed.slice(0, 2).forEach(group => prefetchSpeech(group))
  }, [edition.fetchedAt])

  const toggleAudio = () => {
    if (audioOn) {
      speech.current?.stop()
      setAudioOn(false)
      setAudioBusy(false)
      return
    }
    const sections = edition.brief.sections
      .map((s, i) => {
        const script = s.script.replace(/\s+/g, ' ').trim()
        return i === 0 ? liveBriefOpener(script) : script
      })
      .filter(Boolean)
      .map(script => ({ script }))
    if (!canSpeak() || !sections.length) return
    setAudioBusy(true)
    setAudioOn(true)
    speech.current = speakSections(
      sections,
      0,
      1,
      () => setAudioBusy(false),
      () => {
        setAudioOn(false)
        setAudioBusy(false)
      },
    )
  }

  return (
    <div className="pb-10 md:pb-12">
      <section className="relative">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-5 md:px-10 pt-4 sm:pt-5 pb-2">
          <div
            className="rounded-2xl px-4 py-5 sm:px-6 sm:py-6 md:px-7 md:py-6"
            style={{
              background: 'linear-gradient(145deg, #1E1A16 0%, #16161F 52%, #12121A 100%)',
              border: '1px solid rgba(245,166,35,0.22)',
              boxShadow: '0 16px 40px rgba(0,0,0,0.28)',
            }}
          >
            <div className="text-[11px] tracking-[0.2em] uppercase mb-1.5 font-semibold" style={{ color: '#F5A623' }}>
              {todayLabel()}
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-6">
              <h1 className="font-serif text-[24px] sm:text-[30px] md:text-[34px] leading-[1.08] text-[#EEE8E0]">Today’s Pulse</h1>
              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  onClick={toggleAudio}
                  disabled={!edition.brief.sections.length}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold min-h-10"
                  style={{ background: '#EA580C', color: '#111111', opacity: edition.brief.sections.length ? 1 : 0.4 }}
                >
                  {audioOn ? <PauseIcon fill="#111111" /> : <PlayIcon fill="#111111" />}
                  {audioBusy ? 'Starting…' : audioOn ? 'Stop brief' : 'Today’s brief'}
                </button>
              </div>
            </div>
            <p className="text-sm mt-2" style={{ color: '#9B968F' }}>
              {loading && !rows.length
                ? 'Pulling live stories from newsrooms…'
                : `${edition.brief.storyCount || 0} stories · ${edition.brief.minutes || 2} min listen.`}
            </p>
            {error && (
              <div className="rounded-xl p-3 mt-3 text-sm" style={{ background: 'rgba(138,59,50,0.18)', color: '#E8B4AE' }}>
                {error}
                <button onClick={onRetry} className="ml-3" style={{ color: '#F5A623' }}>Try again</button>
              </div>
            )}
            <div className="mt-5 pt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <label className="relative block">
                <span className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: '#8A8AA0' }}>
                  <SearchIcon />
                </span>
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search today’s stories"
                  className="w-full rounded-xl pl-11 pr-4 py-3 text-sm outline-none min-h-12"
                  style={{ background: '#0E0E18', color: '#EEE8E0', border: '1px solid rgba(255,255,255,0.1)' }}
                />
              </label>
              <div className="flex gap-2 overflow-x-auto scrollbar-none mt-4 pb-0.5 -mx-1 px-1">
                {labels.map(label => (
                  <span key={label} className="shrink-0">
                    <Tag label={label} active={topic === label} onClick={() => setTopic(label)} />
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {searching ? (
        <div className="max-w-[1320px] mx-auto px-4 sm:px-5 md:px-10 mt-5">
          <div className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
            {results.map(story => (
              <PosterCard
                key={`${story.id}-${story.shelf}`}
                story={story}
                onClick={() => onStoryTap(story)}
                onPrefetch={() => { void prefetchStoryArticle(story) }}
                layout="grid"
              />
            ))}
          </div>
          {results.length === 0 && (
            <p className="text-sm mt-2" style={{ color: '#8A8AA0' }}>No stories match that search.</p>
          )}
        </div>
      ) : (
        <div className="mt-5">
          {rows.map(shelf => (
            <ShelfRow
              key={shelf.label}
              title={shelfTitle(shelf.label)}
              stories={shelf.stories}
              onOpen={onStoryTap}
            />
          ))}
          {!rows.length && !loading && (
            <p className="px-4 sm:px-5 md:px-10 text-sm" style={{ color: '#9B968F' }}>No stories yet. Refresh the edition.</p>
          )}
        </div>
      )}
    </div>
  )
}

function StoryPage({ story, onBack }: { story: StoryCard; onBack: () => void }) {
  const links = sourceLinks(story)
  const readUrl = primaryReadUrl(story)
  const [paragraphs, setParagraphs] = useState<string[]>(story.body?.length ? story.body : [])
  const [heroImage, setHeroImage] = useState(story.image)
  const [loadingArticle, setLoadingArticle] = useState(false)
  const [articleError, setArticleError] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [listenBusy, setListenBusy] = useState(false)
  const speech = useRef<SpeechHandle | null>(null)

  useEffect(() => {
    speech.current?.stop()
    setListening(false)
    setListenBusy(false)
    setParagraphs(story.body?.length ? story.body : [])
    setHeroImage(story.image)
    setArticleError(null)
    return () => speech.current?.stop()
  }, [story.id, story.body, story.image])

  useEffect(() => {
    let live = true
    setLoadingArticle(true)
    setArticleError(null)
    prefetchStoryArticle(story)
      .then(data => {
        if (!live) return
        if (data.paragraphs?.length) setParagraphs(cleanArticleParagraphs(data.paragraphs))
        else if (!story.whatHappened.length && !story.summary) {
          setArticleError(data.error || 'Could not extract the full article text from the publisher page.')
        }
        if (data.image) setHeroImage(data.image)
      })
      .catch(err => {
        if (!live || (err as Error).name === 'AbortError') return
        setArticleError(err instanceof Error ? err.message : 'Could not load the article.')
      })
      .finally(() => {
        if (live) setLoadingArticle(false)
      })
    return () => {
      live = false
    }
  }, [story.id])

  const rawBody = paragraphs.length ? paragraphs : story.whatHappened.length ? story.whatHappened : [story.summary]
  const cleanedBody = cleanArticleParagraphs(rawBody)
  const body = cleanedBody.length ? cleanedBody : rawBody.filter(p => p.trim() && !/you can also check/i.test(p))
  const listenScripts = storyListenScripts(story, body)
  const canListen = canSpeak() && listenScripts.length > 0

  const toggleListen = () => {
    if (listening) {
      speech.current?.stop()
      setListening(false)
      setListenBusy(false)
      return
    }
    if (!canListen) return
    setListenBusy(true)
    setListening(true)
    speech.current = speakSections(
      listenScripts,
      0,
      1,
      () => setListenBusy(false),
      () => {
        setListening(false)
        setListenBusy(false)
      },
    )
  }

  return (
    <div className="max-w-[860px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      <button onClick={onBack} className="flex items-center gap-1 text-sm mb-6 sm:mb-8 min-h-10" style={{ color: '#8A8AA0' }}>
        <ChevronLeft /> Back
      </button>
      {heroImage && <img src={heroImage} alt="" referrerPolicy="no-referrer" className="w-full h-48 sm:h-64 md:h-72 object-cover rounded-2xl mb-6 sm:mb-8" />}
      <div className="flex flex-wrap items-center gap-2 text-[12px] mb-4" style={{ color: '#8A8AA0' }}>
        <span style={{ color: '#F5A623' }}>{sourceName(story)}</span>
        <span>·</span>
        <span>{shelfTitle(story.shelf)}</span>
        <span>·</span>
        <span>{story.time}</span>
      </div>
      <h1 className="font-serif text-[#EEE8E0] text-[26px] sm:text-[32px] md:text-[36px] leading-tight mb-5">{story.headline}</h1>
      <button
        onClick={toggleListen}
        disabled={!canListen}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold mb-8 min-h-10"
        style={{
          background: listening ? '#EA580C' : '#17172A',
          color: listening ? '#111111' : '#EEE8E0',
          border: listening ? 'none' : '1px solid rgba(255,255,255,0.12)',
          opacity: canListen ? 1 : 0.4,
        }}
      >
        {listening && !listenBusy ? <PauseIcon fill="currentColor" /> : <ListenIcon />}
        {listenBusy ? 'Starting…' : listening ? 'Stop' : 'Listen'}
      </button>
      <div className="mb-10">
        {loadingArticle && <p className="text-sm mb-4" style={{ color: '#9B968F' }}>Loading the original article…</p>}
        {articleError && !paragraphs.length && (
          <p className="text-sm mb-4" style={{ color: '#E8B4AE' }}>{articleError}</p>
        )}
        <div className="space-y-5">
          {body.map((p, i) => (
            <p key={i} className="text-[16px] sm:text-[17px] leading-[1.9]" style={{ color: '#C8C2B8' }}>{p}</p>
          ))}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-semibold tracking-[0.22em] uppercase mb-4" style={{ color: '#8A8AA0' }}>Source</div>
        <div className="space-y-2">
          {links.map(pub => (
            <a
              key={pub.url + pub.name}
              href={pub.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-3 px-4 py-3.5 rounded-xl min-w-0"
              style={{ background: '#141424', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <span className="text-sm font-medium truncate" style={{ color: '#EEE8E0' }}>{pub.name}</span>
              <span className="shrink-0 text-[11px]" style={{ color: '#F5A623' }}>Open →</span>
            </a>
          ))}
          {!links.length && readUrl && (
            <a href={readUrl} target="_blank" rel="noreferrer" className="text-sm" style={{ color: '#F5A623' }}>
              Open original →
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function ProfilePage({
  locations,
  topics,
  fetchedAt,
  onToggleLoc,
  onToggleTopic,
  onNext,
}: {
  locations: string[]
  topics: string[]
  fetchedAt: string
  onToggleLoc: (s: string) => void
  onToggleTopic: (s: string) => void
  onNext: () => void
}) {
  const locSet = new Set(locations)
  const topicSet = new Set(topics)
  return (
    <div className="max-w-[760px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 pb-10">
      <h1 className="font-serif text-[#EEE8E0] text-[32px] sm:text-[40px] mb-2">Edit topics</h1>
      <p className="text-sm mb-8" style={{ color: '#9B968F' }}>Tap a chip to add or remove it from Home.</p>
      <div className="rounded-2xl p-5 mb-4" style={{ background: '#141424', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="text-[10px] font-semibold tracking-[0.22em] uppercase mb-3" style={{ color: '#8A8AA0' }}>Cities</div>
        <div className="flex flex-wrap gap-2 mb-6">
          {CITIES.map(c => <Tag key={c} label={c} active={locSet.has(c)} onClick={() => onToggleLoc(c)} />)}
        </div>
        <div className="text-[10px] font-semibold tracking-[0.22em] uppercase mb-3" style={{ color: '#8A8AA0' }}>States & regions</div>
        <div className="flex flex-wrap gap-2 mb-6">
          {STATES.map(s => <Tag key={s} label={s} active={locSet.has(s)} onClick={() => onToggleLoc(s)} />)}
        </div>
        <div className="text-[10px] font-semibold tracking-[0.22em] uppercase mb-3" style={{ color: '#8A8AA0' }}>Broader coverage</div>
        <div className="flex flex-wrap gap-2">
          {['India', 'World'].map(g => <Tag key={g} label={g} active={locSet.has(g)} onClick={() => onToggleLoc(g)} />)}
        </div>
      </div>
      <div className="rounded-2xl p-5 mb-6" style={{ background: '#141424', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="text-[10px] font-semibold tracking-[0.22em] uppercase mb-3" style={{ color: '#8A8AA0' }}>Topics</div>
        <div className="flex flex-wrap gap-2">
          {TOPICS.map(t => <Tag key={t} label={t} active={topicSet.has(t)} onClick={() => onToggleTopic(t)} />)}
        </div>
      </div>
      <button
        onClick={onNext}
        disabled={!locations.length}
        className="w-full sm:w-auto px-8 py-4 rounded-xl text-base font-semibold min-h-12"
        style={{ background: '#EA580C', color: '#111111', opacity: locations.length ? 1 : 0.35 }}
      >
        Next →
      </button>
      <p className="text-sm mt-4" style={{ color: '#9B968F' }}>
        {fetchedAt ? `Last pulled ${new Date(fetchedAt).toLocaleString('en-IN')}` : 'No live edition yet'}
      </p>
    </div>
  )
}

function AppShell({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh overflow-x-hidden" style={{ background: '#07070C' }}>{children}</div>
}

const GUEST_SESSION: Session = { name: '', email: '', loggedInAt: '' }

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [session, setSession] = useState<Session | null>(GUEST_SESSION)
  const [selLoc, setSelLoc] = useState<Set<string>>(new Set(['Pune', 'Maharashtra', 'India', 'World']))
  const [selTopics, setSelTopics] = useState<Set<string>>(new Set(['Technology', 'Business', 'Sports']))
  const [onboarded, setOnboarded] = useState(true)
  const [activeStory, setActiveStory] = useState<StoryCard | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [edition, setEdition] = useState<NewsPayload>(emptyEdition())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const editionRef = useRef(edition)
  editionRef.current = edition
  const activeStoryRef = useRef(activeStory)
  activeStoryRef.current = activeStory

  const applyRoute = (screen: Screen, storyId?: string) => {
    if (screen === 'story') {
      const found = (storyId && findStory(editionRef.current, storyId)) || (storyId && activeStoryRef.current?.id === storyId ? activeStoryRef.current : null)
      if (found) {
        setActiveStory(found)
        setScreen('story')
        return
      }
      setActiveStory(null)
      setScreen('home')
      return
    }
    setScreen(screen)
  }

  const pushRoute = (next: Screen, story?: StoryCard) => {
    const storyId = story?.id
    const path = pathFor(next, storyId)
    if (window.location.pathname !== path) {
      history.pushState({ screen: next, storyId }, '', path)
    }
    if (story) setActiveStory(story)
    setScreen(next)
  }

  const backInPulse = () => {
    if (window.history.state?.screen || window.location.pathname !== '/') {
      history.back()
      return
    }
    history.replaceState({ screen: 'home' }, '', '/')
    setScreen('home')
  }

  useEffect(() => {
    const existing = readSession()
    const prefs = readPrefs()
    const locs = prefs?.locations?.length ? prefs.locations : ['Pune', 'Maharashtra', 'India', 'World']
    const topics = prefs?.topics?.length ? prefs.topics : ['Technology', 'Business', 'Sports']
    if (prefs?.locations?.length) setSelLoc(new Set(prefs.locations))
    if (prefs?.topics) setSelTopics(new Set(prefs.topics))
    const cached = readCachedEdition(locs, topics)
    if (cached?.shelves.length) setEdition(cached)
    setSession(existing ?? GUEST_SESSION)
    setOnboarded(true)
    const route = parsePath(window.location.pathname)
    history.replaceState({ screen: route.screen, storyId: route.storyId }, '', pathFor(route.screen, route.storyId))
    setScreen(route.screen === 'story' ? 'story' : route.screen)
    setHydrated(true)
  }, [])

  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const state = event.state as { screen?: Screen; storyId?: string } | null
      const route = state?.screen ? { screen: state.screen, storyId: state.storyId } : parsePath(window.location.pathname)
      applyRoute(route.screen, route.storyId)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    writePrefs({
      locations: [...selLoc],
      topics: [...selTopics],
      onboarded,
    })
  }, [selLoc, selTopics, onboarded, hydrated])

  useEffect(() => {
    if (!hydrated || !session || !onboarded) return
    const ctrl = new AbortController()
    const locs = [...selLoc]
    const topics = [...selTopics]
    const cached = readCachedEdition(locs, topics)
    if (cached?.shelves.length) {
      setEdition(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }
    setError(null)
    loadEdition(locs, topics, ctrl.signal, refreshNonce > 0)
      .then(setEdition)
      .catch(err => {
        if ((err as Error).name === 'AbortError') return
        if (cached?.shelves.length) return
        setError(err instanceof Error ? err.message : 'Could not load today’s edition.')
      })
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [hydrated, session, onboarded, selLoc, selTopics, refreshNonce])

  const toggleLoc = (loc: string) =>
    setSelLoc(prev => {
      const n = new Set(prev)
      n.has(loc) ? n.delete(loc) : n.add(loc)
      if (!n.size) return prev
      return n
    })

  const toggleTopic = (t: string) =>
    setSelTopics(prev => {
      const n = new Set(prev)
      n.has(t) ? n.delete(t) : n.add(t)
      return n
    })

  useEffect(() => {
    if (screen !== 'story' || activeStory) return
    const id = parsePath(window.location.pathname).storyId
    if (!id) {
      setScreen('home')
      return
    }
    const found = findStory(edition, id)
    if (found) setActiveStory(found)
  }, [edition, screen, activeStory])

  const handleStoryTap = (story: StoryCard) => {
    void prefetchStoryArticle(story)
    pushRoute('story', story)
  }

  const goTab = (tab: Tab) => {
    if (tab === screen || (tab === 'home' && screen === 'story')) {
      if (tab === 'home' && screen === 'story') {
        backInPulse()
        return
      }
      if (tab === screen) return
    }
    pushRoute(tab)
  }
  const tab: Tab = screen === 'profile' ? 'profile' : 'home'

  if (!hydrated) return <div className="min-h-dvh" style={{ background: '#07070C' }} />
  if (screen === 'onboarding-location') {
    return <OnboardingLocation selected={selLoc} onToggle={toggleLoc} onNext={() => pushRoute('onboarding-topics')} />
  }
  if (screen === 'onboarding-topics') {
    return (
      <OnboardingTopics
        selected={selTopics}
        onToggle={toggleTopic}
        onDone={() => {
          setOnboarded(true)
          setRefreshNonce(n => n + 1)
          pushRoute('home')
        }}
      />
    )
  }

  return (
    <AppShell>
      <SiteHeader
        tab={tab}
        onNavigate={goTab}
        onRefresh={() => setRefreshNonce(n => n + 1)}
        refreshing={loading}
      />
      {screen === 'home' && (
        <HomePage
          edition={edition}
          loading={loading}
          error={error}
          onRetry={() => setRefreshNonce(n => n + 1)}
          onStoryTap={handleStoryTap}
        />
      )}
      {screen === 'profile' && (
        <ProfilePage
          locations={[...selLoc]}
          topics={[...selTopics]}
          fetchedAt={edition.fetchedAt}
          onToggleLoc={toggleLoc}
          onToggleTopic={toggleTopic}
          onNext={() => {
            setRefreshNonce(n => n + 1)
            pushRoute('home')
          }}
        />
      )}
      {screen === 'story' && activeStory && (
        <StoryPage story={activeStory} onBack={backInPulse} />
      )}
    </AppShell>
  )
}
