import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { emptyEdition, getCachedStoryArticle, loadEdition, prefetchStoryArticle, readCachedEdition } from './lib/news'
import { isFullArticle } from './lib/articleExtract'
import { cleanArticleParagraphs } from './lib/articleText'
import { detectHomePlace, queryGeolocationPermission, subscribeGeolocationPermission, takeEarlyDetect } from './lib/location'
import {
  BROADER,
  CITIES,
  CITY_TO_STATE,
  STATES,
  TOPICS,
  homePlaceLabel,
  isLegacyDefaultLocations,
  mergeHomeLocations,
  type City,
  type HomePlace,
  type StateName,
} from './lib/places'
import { readPrefs, readSession, writePrefs, applyTheme, readTabLocationGranted, writeTabLocation, type ThemeName } from './lib/session'
import { canSpeak, packScriptGroups, prefetchSpeech, speakSections, type SpeechHandle } from './lib/speech'
import type { NewsPayload, Screen, Session, StoryCard, Tab } from './types'

function dayGreeting(at = new Date()) {
  const hour = at.getHours()
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function liveBriefOpener(script: string) {
  if (!/^Good (morning|afternoon|evening)\b/i.test(script)) return script
  return `${dayGreeting()}! Here's today's Pulse.`
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

function prefetchStoryListen(story: StoryCard, paragraphs: string[] = []) {
  const packed = packScriptGroups(storyListenScripts(story, paragraphs).map(s => s.script))
  if (packed[0]) prefetchSpeech(packed[0])
  if (packed[1]) prefetchSpeech(packed[1])
}

function orderedShelves(shelves: NewsPayload['shelves'], home?: HomePlace) {
  const citySet = new Set<string>(CITIES)
  const stateSet = new Set<string>(STATES)
  const homeCity: NewsPayload['shelves'] = []
  const cities: NewsPayload['shelves'] = []
  const homeState: NewsPayload['shelves'] = []
  const states: NewsPayload['shelves'] = []
  const topics: NewsPayload['shelves'] = []
  for (const shelf of shelves) {
    const title = shelfTitle(shelf.label)
    if (home?.city && title === home.city) homeCity.push(shelf)
    else if (citySet.has(title)) cities.push(shelf)
    else if (home?.state && title === home.state) homeState.push(shelf)
    else if (stateSet.has(title)) states.push(shelf)
    else topics.push(shelf)
  }
  return [...homeCity, ...cities, ...homeState, ...states, ...topics]
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

function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.2" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v1.6M12 19.4V21M4.6 12H3M21 12h-1.6M6.2 6.2l1.1 1.1M16.7 16.7l1.1 1.1M17.8 6.2l-1.1 1.1M7.3 16.7l-1.1 1.1" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 14.5A7.5 7.5 0 1 1 9.5 4 6.4 6.4 0 0 0 20 14.5Z" />
    </svg>
  )
}

function usableCover(src?: string) {
  const url = src?.trim() || ''
  if (!/^https?:\/\//i.test(url)) return false
  return !/1x1|pixel|spacer|blank\.(gif|png)|placeholder|no[-_]?image|missing/i.test(url)
}

function sourceMark(name?: string) {
  const n = (name || '').toLowerCase()
  if (/economic times/.test(n)) return 'ET'
  if (/times of india|\btoi\b/.test(n)) return 'TOI'
  if (/\bndtv\b/.test(n)) return 'NDTV'
  if (/indian express/.test(n)) return 'IE'
  if (/\bmint\b|livemint/.test(n)) return 'MINT'
  if (/\bcnbc/.test(n)) return 'CNBC'
  const parts = (name || 'Pulse').split(/[\s./-]+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return (name || 'PULSE').replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'PULSE'
}

function CoverFallback({ source }: { source?: string }) {
  const uid = useId().replace(/:/g, '')
  const mark = sourceMark(source)
  const markSize = mark.length > 3 ? 28 : mark.length === 3 ? 34 : 42
  return (
    <div className="news-fallback absolute inset-0" aria-hidden>
      <svg viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
        <defs>
          <linearGradient id={`sky-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--fallback-sky-a)" />
            <stop offset="55%" stopColor="var(--fallback-sky-b)" />
            <stop offset="100%" stopColor="var(--fallback-sky-c)" />
          </linearGradient>
          <linearGradient id={`glow-${uid}`} x1="0.2" y1="0" x2="0.9" y2="1">
            <stop offset="0%" stopColor="var(--orange)" stopOpacity="0.38" />
            <stop offset="100%" stopColor="var(--orange)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#sky-${uid})`} />
        <circle cx="530" cy="64" r="150" fill={`url(#glow-${uid})`} />
        <g fill="var(--fallback-city)" opacity="0.55">
          <rect x="0" y="248" width="70" height="112" />
          <rect x="78" y="214" width="52" height="146" />
          <rect x="140" y="232" width="84" height="128" />
          <rect x="234" y="198" width="58" height="162" />
          <rect x="302" y="240" width="92" height="120" />
          <rect x="404" y="210" width="66" height="150" />
          <rect x="480" y="184" width="50" height="176" />
          <rect x="540" y="226" width="100" height="134" />
        </g>
        <rect x="48" y="52" width="318" height="214" rx="18" fill="var(--fallback-paper)" />
        <rect x="68" y="72" width="118" height="86" rx="8" fill="var(--orange)" />
        <path d="M86 132h28l12-22 14 38 10-18h28" fill="none" stroke="#FFF7F2" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="204" y="80" width="138" height="10" rx="5" fill="var(--fallback-ink)" />
        <rect x="204" y="100" width="112" height="7" rx="3.5" fill="var(--fallback-rule)" />
        <rect x="204" y="116" width="128" height="7" rx="3.5" fill="var(--fallback-rule)" />
        <rect x="204" y="132" width="96" height="7" rx="3.5" fill="var(--fallback-rule)" />
        <rect x="68" y="176" width="274" height="6" rx="3" fill="var(--fallback-rule)" />
        <rect x="68" y="192" width="252" height="6" rx="3" fill="var(--fallback-rule)" />
        <rect x="68" y="208" width="228" height="6" rx="3" fill="var(--fallback-rule)" />
        <rect x="68" y="224" width="176" height="6" rx="3" fill="var(--fallback-rule)" />
        <rect x="408" y="118" width="168" height="92" rx="22" fill="var(--orange)" />
        <text
          x="492"
          y="176"
          textAnchor="middle"
          fill="#FFF7F2"
          fontFamily="Outfit, system-ui, sans-serif"
          fontSize={markSize}
          fontWeight="700"
        >
          {mark}
        </text>
        <text
          x="492"
          y="236"
          textAnchor="middle"
          fill="var(--amber)"
          fontFamily="Outfit, system-ui, sans-serif"
          fontSize="13"
          fontWeight="600"
          letterSpacing="4"
        >
          PULSE
        </text>
      </svg>
    </div>
  )
}

function CoverImage({
  src,
  className,
  source,
}: {
  src?: string
  className?: string
  source?: string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [src])
  const showImg = usableCover(src) && !failed
  return (
    <div className={`news-cover relative overflow-hidden ${className || ''}`}>
      {showImg ? (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          className="absolute inset-0 block h-full w-full max-w-none object-cover object-center transition-transform duration-300 group-hover:scale-105"
          onError={() => setFailed(true)}
        />
      ) : (
        <CoverFallback source={source} />
      )}
    </div>
  )
}

function Tag({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 sm:px-4 py-2 rounded-full text-sm transition-all duration-150 min-h-10"
      style={
        active
          ? { background: 'var(--orange)', color: '#FFFFFF', fontWeight: 600 }
          : { background: 'var(--elevated)', color: 'var(--chip-text)', border: '1px solid var(--border)' }
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
      <span className="hidden min-[380px]:inline text-[11px] md:text-[12px] font-semibold tracking-[0.32em] md:tracking-[0.38em] uppercase" style={{ color: 'var(--amber)' }}>
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
  home,
  detecting,
  theme,
  onNavigate,
  onRefresh,
  onToggleTheme,
  refreshing,
}: {
  tab: Tab
  home: HomePlace
  detecting: boolean
  theme: ThemeName
  onNavigate: (next: Tab) => void
  onRefresh: () => void
  onToggleTheme: () => void
  refreshing: boolean
}) {
  const editing = tab === 'profile'
  const city = home.city
  const state = home.state
  const locLabel = city || (detecting ? 'Locating…' : 'World')
  const locTitle = homePlaceLabel(home) || locLabel
  return (
    <header className="sticky top-0 z-50 pulse-header">
      <div className="px-3 sm:px-5 md:px-10 h-14 md:h-16 flex items-center gap-2 sm:gap-3">
        <button onClick={() => onNavigate('home')} className="shrink-0">
          <BrandMark size={24} />
        </button>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2 min-w-0">
          <button
            type="button"
            onClick={() => onNavigate('profile')}
            className={`header-chip is-location ${editing ? 'is-active' : ''}`}
            title={locTitle}
            aria-label={`Location: ${locTitle}`}
          >
            <PinIcon />
            <span className="min-w-0 truncate">
              {locLabel}
              {city && state ? (
                <span className="hidden sm:inline" style={{ color: 'var(--muted)', fontWeight: 500 }}>
                  {' · '}{state}
                </span>
              ) : null}
            </span>
          </button>
          <button
            onClick={() => onNavigate('profile')}
            className={`header-chip ${editing ? 'is-active' : ''}`}
          >
            <span className="sm:hidden">Topics</span>
            <span className="hidden sm:inline">Edit topics</span>
          </button>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="header-chip"
            style={{ color: 'var(--amber)' }}
          >
            {refreshing ? 'Updating…' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            className="header-icon"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </div>
    </header>
  )
}

function OnboardingLocation({
  selected,
  home,
  detecting,
  onToggle,
  onDetect,
  onNext,
}: {
  selected: Set<string>
  home: HomePlace
  detecting: boolean
  onToggle: (s: string) => void
  onDetect: () => void
  onNext: () => void
}) {
  const found = homePlaceLabel(home)
  return (
    <div className="min-h-dvh" style={{ background: 'var(--paper)' }}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <div className="mb-8 sm:mb-10">
          <BrandMark size={26} />
        </div>
        <h1 className="font-serif text-[color:var(--ink)] text-[32px] sm:text-[42px] leading-tight mb-3">Where should we pull news from?</h1>
        <p className="text-sm sm:text-base mb-4" style={{ color: 'var(--muted)' }}>
          {detecting
            ? 'Waiting for location permission…'
            : found
              ? `Your local rows stay on: ${found}. Add anywhere else you follow.`
              : 'We’ll show World news until the browser has your location, or you pick a city.'}
        </p>
        <button
          type="button"
          onClick={onDetect}
          disabled={detecting}
          className="mb-8 sm:mb-10 text-sm font-semibold min-h-10"
          style={{ color: 'var(--amber)' }}
        >
          {detecting ? 'Locating…' : found ? 'Update from my location' : 'Use my location'}
        </button>
        <div className="space-y-8 mb-10 sm:mb-12">
          <div>
            <div className="text-[10px] font-semibold tracking-[0.2em] uppercase mb-3" style={{ color: 'var(--dim)' }}>Cities</div>
            <div className="flex flex-wrap gap-2">{CITIES.map(c => <Tag key={c} label={c} active={selected.has(c)} onClick={() => onToggle(c)} />)}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold tracking-[0.2em] uppercase mb-3" style={{ color: 'var(--dim)' }}>States & regions</div>
            <div className="flex flex-wrap gap-2">{STATES.map(s => <Tag key={s} label={s} active={selected.has(s)} onClick={() => onToggle(s)} />)}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold tracking-[0.2em] uppercase mb-3" style={{ color: 'var(--dim)' }}>Broader coverage</div>
            <div className="flex flex-wrap gap-2">{BROADER.map(g => <Tag key={g} label={g} active={selected.has(g)} onClick={() => onToggle(g)} />)}</div>
          </div>
        </div>
        <button
          onClick={onNext}
          disabled={selected.size === 0}
          className="w-full sm:w-auto px-8 py-4 rounded-xl text-base font-semibold min-h-12"
          style={{ background: 'var(--orange)', color: '#FFFFFF', opacity: selected.size === 0 ? 0.35 : 1 }}
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
    <div className="min-h-dvh" style={{ background: 'var(--paper)' }}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <div className="mb-8 sm:mb-10">
          <BrandMark size={26} />
        </div>
        <h1 className="font-serif text-[color:var(--ink)] text-[32px] sm:text-[42px] leading-tight mb-3">Any extra topics?</h1>
        <p className="text-sm sm:text-base mb-8 sm:mb-10" style={{ color: 'var(--muted)' }}>These show up as extra rows under your city, state, India, and World.</p>
        <div className="flex flex-wrap gap-2 mb-6">
          {TOPICS.map(t => <Tag key={t} label={t} active={selected.has(t)} onClick={() => onToggle(t)} />)}
        </div>
        <button onClick={onDone} className="w-full sm:w-auto px-8 py-4 rounded-xl text-base font-semibold min-h-12" style={{ background: 'var(--orange)', color: '#FFFFFF' }}>
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
  const node = useRef<HTMLButtonElement>(null)
  const prefetch = useRef(onPrefetch)
  prefetch.current = onPrefetch
  useEffect(() => {
    const el = node.current
    if (!el || !prefetch.current) return
    const io = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) return
        prefetch.current?.()
        io.disconnect()
      },
      { rootMargin: '280px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [story.id])
  return (
    <button
      ref={node}
      onClick={onClick}
      onPointerDown={onPrefetch}
      onFocus={onPrefetch}
      className={
        rail
          ? 'news-card shrink-0 w-[86%] sm:w-[240px] md:w-[272px] text-left rounded-2xl overflow-hidden snap-start group'
          : 'news-card w-full min-w-0 text-left rounded-2xl overflow-hidden group'
      }
    >
      <div
        className={rail ? 'relative h-[168px] sm:h-[150px] md:h-[168px] overflow-hidden' : 'relative h-[150px] sm:h-[160px] overflow-hidden'}
        style={{ background: 'var(--elevated)' }}
      >
        <CoverImage
          src={story.image}
          source={sourceName(story)}
          className="h-full w-full"
        />
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'var(--poster-wash)' }} />
      </div>
      <div className="p-3.5 sm:p-3.5">
        <div className="text-[11px] mb-1.5 truncate font-semibold" style={{ color: 'var(--amber)' }}>{sourceName(story)} · {story.time}</div>
        <div className="text-[15px] sm:text-[15px] font-medium leading-snug line-clamp-2" style={{ color: 'var(--ink)' }}>{story.headline}</div>
      </div>
    </button>
  )
}

function RowArrow({ dir, label, onClick }: { dir: 'left' | 'right'; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="nav-btn hidden sm:flex w-10 h-10 lg:w-11 lg:h-11 justify-self-center"
      style={{ background: 'var(--elevated)', color: 'var(--ink)', border: '1px solid var(--border-strong)' }}
      aria-label={label}
    >
      <NavChevron dir={dir} size={18} />
    </button>
  )
}

function ShelfRow({ title, stories, onOpen }: { title: string; stories: StoryCard[]; onOpen: (s: StoryCard) => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  const scrollBy = (dir: number) => {
    const el = scroller.current
    if (!el) return
    el.scrollBy({ left: dir * Math.min(el.clientWidth * 0.86, 720), behavior: 'smooth' })
  }
  if (!stories.length) return null
  return (
    <section className="mb-7 sm:mb-8">
      <div className="px-4 sm:grid sm:grid-cols-[44px_minmax(0,1fr)_44px] lg:grid-cols-[52px_minmax(0,1fr)_52px] sm:px-2 md:px-3 mb-2 sm:mb-2.5 items-center">
        <div className="hidden sm:block" />
        <h2 className="sm:px-1 text-[20px] md:text-[22px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          {title}
        </h2>
        <div className="hidden sm:block" />
      </div>
      <div className="sm:grid sm:grid-cols-[44px_minmax(0,1fr)_44px] lg:grid-cols-[52px_minmax(0,1fr)_52px] items-center sm:px-2 md:px-3">
        <RowArrow dir="left" label={`Scroll ${title} left`} onClick={() => scrollBy(-1)} />
        <div ref={scroller} className="row-scroll min-w-0">
          {stories.map(story => (
            <PosterCard
              key={story.id}
              story={story}
              onClick={() => onOpen(story)}
              onPrefetch={() => { void prefetchStoryArticle(story); prefetchStoryListen(story) }}
            />
          ))}
        </div>
        <RowArrow dir="right" label={`Scroll ${title} right`} onClick={() => scrollBy(1)} />
      </div>
    </section>
  )
}

function searchStories(edition: NewsPayload, query: string, topic: string, home?: HomePlace) {
  const q = query.trim().toLowerCase()
  return orderedShelves(edition.shelves, home)
    .filter(s => topic === 'All' || shelfTitle(s.label) === topic)
    .flatMap(s => s.stories)
    .filter(s => !q || `${s.headline} ${s.summary} ${s.category} ${s.shelf} ${sourceName(s)}`.toLowerCase().includes(q))
}

function HomePage({
  edition,
  loading,
  error,
  home,
  onRetry,
  onStoryTap,
}: {
  edition: NewsPayload
  loading: boolean
  error: string | null
  home: HomePlace
  onRetry: () => void
  onStoryTap: (s: StoryCard) => void
}) {
  const [audioOn, setAudioOn] = useState(false)
  const [audioBusy, setAudioBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [topic, setTopic] = useState('All')
  const speech = useRef<SpeechHandle | null>(null)
  const rows = orderedShelves(edition.shelves, home)
  const labels = ['All', ...rows.map(s => shelfTitle(s.label))]
  const searching = Boolean(query.trim()) || topic !== 'All'
  const results = searching ? searchStories(edition, query, topic, home) : []

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
              background: 'var(--hero)',
              border: '1px solid var(--amber-border)',
              boxShadow: 'var(--shadow)',
            }}
          >
            <div className="text-[11px] tracking-[0.2em] uppercase mb-1.5 font-semibold" style={{ color: 'var(--amber)' }}>
              {todayLabel()}
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-6">
              <h1 className="font-serif text-[24px] sm:text-[30px] md:text-[34px] leading-[1.08] text-[color:var(--ink)]">Today’s Pulse</h1>
              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  onClick={toggleAudio}
                  disabled={!edition.brief.sections.length}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold min-h-10"
                  style={{ background: 'var(--orange)', color: '#FFFFFF', opacity: edition.brief.sections.length ? 1 : 0.4 }}
                >
                  {audioOn ? <PauseIcon fill="#FFFFFF" /> : <PlayIcon fill="#FFFFFF" />}
                  {audioBusy ? 'Starting…' : audioOn ? 'Stop brief' : 'Today’s brief'}
                </button>
              </div>
            </div>
            <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
              {loading && !rows.length
                ? 'Pulling live stories from newsrooms…'
                : `${edition.brief.storyCount || 0} stories · ${edition.brief.minutes || 2} min listen.`}
            </p>
            {error && (
              <div className="rounded-xl p-3 mt-3 text-sm" style={{ background: 'var(--error-bg)', color: 'var(--error-text)' }}>
                {error}
                <button onClick={onRetry} className="ml-3" style={{ color: 'var(--amber)' }}>Try again</button>
              </div>
            )}
            <div className="mt-5 pt-5" style={{ borderTop: '1px solid var(--border)' }}>
              <label className="relative block">
                <span className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--dim)' }}>
                  <SearchIcon />
                </span>
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search today’s stories"
                  className="w-full rounded-xl pl-11 pr-4 py-3 text-sm outline-none min-h-12"
                  style={{ background: 'var(--input)', color: 'var(--ink)', border: '1px solid var(--border-strong)' }}
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
                onPrefetch={() => { void prefetchStoryArticle(story); prefetchStoryListen(story) }}
                layout="grid"
              />
            ))}
          </div>
          {results.length === 0 && (
            <p className="text-sm mt-2" style={{ color: 'var(--dim)' }}>No stories match that search.</p>
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
            <p className="px-4 sm:px-5 md:px-10 text-sm" style={{ color: 'var(--muted)' }}>No stories yet. Refresh the edition.</p>
          )}
        </div>
      )}
    </div>
  )
}

function StoryPage({ story, onBack }: { story: StoryCard; onBack: () => void }) {
  const links = sourceLinks(story)
  const readUrl = primaryReadUrl(story)
  const cached = getCachedStoryArticle(story)
  const cachedFull = isFullArticle(cached?.paragraphs || [], story.summary)
  const [paragraphs, setParagraphs] = useState<string[]>(
    cachedFull && cached?.paragraphs?.length ? cached.paragraphs : story.body?.length ? story.body : [],
  )
  const [heroImage, setHeroImage] = useState(cached?.image || story.image)
  const [loadingArticle, setLoadingArticle] = useState(!cachedFull)
  const [articleError, setArticleError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const [listening, setListening] = useState(false)
  const [listenBusy, setListenBusy] = useState(false)
  const speech = useRef<SpeechHandle | null>(null)

  useEffect(() => {
    speech.current?.stop()
    setListening(false)
    setListenBusy(false)
    const fresh = getCachedStoryArticle(story)
    const full = isFullArticle(fresh?.paragraphs || [], story.summary)
    setParagraphs(full && fresh?.paragraphs?.length ? fresh.paragraphs : story.body?.length ? story.body : [])
    setHeroImage(fresh?.image || story.image)
    setArticleError(null)
    setLoadingArticle(!full)
    return () => speech.current?.stop()
  }, [story.id, story.body, story.image])

  useEffect(() => {
    let live = true
    const ready = getCachedStoryArticle(story)
    const full = retryNonce === 0 && isFullArticle(ready?.paragraphs || [], story.summary)
    if (!full) setLoadingArticle(true)
    setArticleError(null)
    prefetchStoryArticle(story, { force: retryNonce > 0 })
      .then(data => {
        if (!live) return
        if (isFullArticle(data.paragraphs || [], story.summary)) {
          setParagraphs(cleanArticleParagraphs(data.paragraphs))
          setArticleError(null)
        } else if (!story.whatHappened.length && !story.summary) {
          setArticleError(data.error || 'Could not extract the full article text from the publisher page.')
        } else {
          setArticleError('Could not load the full article from the publisher. Retry, or open the source.')
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
  }, [story.id, retryNonce])

  const rawBody = paragraphs.length ? paragraphs : story.whatHappened.length ? story.whatHappened : [story.summary]
  const cleanedBody = cleanArticleParagraphs(rawBody)
  const body = cleanedBody.length ? cleanedBody : rawBody.filter(p => p.trim() && !/you can also check/i.test(p))
  const listenScripts = storyListenScripts(story, body)
  const canListen = canSpeak() && listenScripts.length > 0

  useEffect(() => {
    if (!canListen) return
    prefetchStoryListen(story, body)
  }, [story.id, body[0], canListen])

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
      <button onClick={onBack} className="flex items-center gap-1 text-sm mb-6 sm:mb-8 min-h-10" style={{ color: 'var(--dim)' }}>
        <ChevronLeft /> Back
      </button>
      <CoverImage src={heroImage} source={sourceName(story)} className="w-full h-48 sm:h-64 md:h-72 rounded-2xl mb-6 sm:mb-8" />
      <div className="flex flex-wrap items-center gap-2 text-[12px] mb-4" style={{ color: 'var(--dim)' }}>
        <span style={{ color: 'var(--amber)' }}>{sourceName(story)}</span>
        <span>·</span>
        <span>{shelfTitle(story.shelf)}</span>
        <span>·</span>
        <span>{story.time}</span>
      </div>
      <h1 className="font-serif text-[color:var(--ink)] text-[26px] sm:text-[32px] md:text-[36px] leading-tight mb-5">{story.headline}</h1>
      <button
        onClick={toggleListen}
        disabled={!canListen}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold mb-8 min-h-10"
        style={{
          background: listening ? 'var(--orange)' : 'var(--elevated)',
          color: listening ? '#FFFFFF' : 'var(--ink)',
          border: listening ? 'none' : '1px solid var(--border-strong)',
          opacity: canListen ? 1 : 0.4,
        }}
      >
        {listening && !listenBusy ? <PauseIcon fill="currentColor" /> : <ListenIcon />}
        {listenBusy ? 'Starting…' : listening ? 'Stop' : 'Listen'}
      </button>
      <div className="mb-10">
        {loadingArticle && !body.length && (
          <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>Loading the original article…</p>
        )}
        {articleError && (
          <p className="text-sm mb-4" style={{ color: 'var(--error-text)' }}>
            {articleError}{' '}
            <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => setRetryNonce(n => n + 1)} style={{ color: 'var(--amber)' }}>
              Retry
            </button>
          </p>
        )}
        <div className="space-y-5">
          {body.map((p, i) => (
            <p key={i} className="text-[16px] sm:text-[17px] leading-[1.9]" style={{ color: 'var(--body)' }}>{p}</p>
          ))}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-semibold tracking-[0.22em] uppercase mb-4" style={{ color: 'var(--dim)' }}>Source</div>
        <div className="space-y-2">
          {links.map(pub => (
            <a
              key={pub.url + pub.name}
              href={pub.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-3 px-4 py-3.5 rounded-xl min-w-0"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <span className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{pub.name}</span>
              <span className="shrink-0 text-[11px]" style={{ color: 'var(--amber)' }}>Open →</span>
            </a>
          ))}
          {!links.length && readUrl && (
            <a href={readUrl} target="_blank" rel="noreferrer" className="text-sm" style={{ color: 'var(--amber)' }}>
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
  home,
  detecting,
  fetchedAt,
  onToggleLoc,
  onToggleTopic,
  onDetect,
  onNext,
}: {
  locations: string[]
  topics: string[]
  home: HomePlace
  detecting: boolean
  fetchedAt: string
  onToggleLoc: (s: string) => void
  onToggleTopic: (s: string) => void
  onDetect: () => void
  onNext: () => void
}) {
  const locSet = new Set(locations)
  const topicSet = new Set(topics)
  const found = homePlaceLabel(home)
  return (
    <div className="max-w-[760px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 pb-10">
      <h1 className="font-serif text-[color:var(--ink)] text-[32px] sm:text-[40px] mb-2">Edit topics</h1>
      <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
        {detecting
          ? 'Waiting for location permission…'
          : found
            ? `${found} stay on as your local rows. Tap other chips to add or remove them.`
            : 'Showing World news until location is allowed. Tap a chip to follow a place.'}
      </p>
      <button
        type="button"
        onClick={onDetect}
        disabled={detecting}
        className="text-sm font-semibold mb-8 min-h-10"
        style={{ color: 'var(--amber)' }}
      >
        {detecting ? 'Locating…' : found ? 'Update from my location' : 'Use my location'}
      </button>
      <div className="rounded-2xl p-5 mb-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="text-[10px] font-semibold tracking-[0.22em] uppercase mb-3" style={{ color: 'var(--dim)' }}>Cities</div>
        <div className="flex flex-wrap gap-2 mb-6">
          {CITIES.map(c => <Tag key={c} label={c} active={locSet.has(c)} onClick={() => onToggleLoc(c)} />)}
        </div>
        <div className="text-[10px] font-semibold tracking-[0.22em] uppercase mb-3" style={{ color: 'var(--dim)' }}>States & regions</div>
        <div className="flex flex-wrap gap-2 mb-6">
          {STATES.map(s => <Tag key={s} label={s} active={locSet.has(s)} onClick={() => onToggleLoc(s)} />)}
        </div>
        <div className="text-[10px] font-semibold tracking-[0.22em] uppercase mb-3" style={{ color: 'var(--dim)' }}>Broader coverage</div>
        <div className="flex flex-wrap gap-2">
          {BROADER.map(g => <Tag key={g} label={g} active={locSet.has(g)} onClick={() => onToggleLoc(g)} />)}
        </div>
      </div>
      <div className="rounded-2xl p-5 mb-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="text-[10px] font-semibold tracking-[0.22em] uppercase mb-3" style={{ color: 'var(--dim)' }}>Topics</div>
        <div className="flex flex-wrap gap-2">
          {TOPICS.map(t => <Tag key={t} label={t} active={topicSet.has(t)} onClick={() => onToggleTopic(t)} />)}
        </div>
      </div>
      <button
        onClick={onNext}
        disabled={!locations.length}
        className="w-full sm:w-auto px-8 py-4 rounded-xl text-base font-semibold min-h-12"
        style={{ background: 'var(--orange)', color: '#FFFFFF', opacity: locations.length ? 1 : 0.35 }}
      >
        Next →
      </button>
      <p className="text-sm mt-4" style={{ color: 'var(--muted)' }}>
        {fetchedAt ? `Last pulled ${new Date(fetchedAt).toLocaleString('en-IN')}` : 'No live edition yet'}
      </p>
    </div>
  )
}

function AppShell({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh overflow-x-hidden" style={{ background: 'var(--paper)' }}>{children}</div>
}

const GUEST_SESSION: Session = { name: '', email: '', loggedInAt: '' }

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [session, setSession] = useState<Session | null>(GUEST_SESSION)
  const [selLoc, setSelLoc] = useState<Set<string>>(new Set(['World', 'India']))
  const [selTopics, setSelTopics] = useState<Set<string>>(new Set(['Technology', 'Business', 'Sports']))
  const [home, setHome] = useState<HomePlace>({})
  const [detecting, setDetecting] = useState(false)
  const [tabLocationOk, setTabLocationOk] = useState(false)
  const [theme, setTheme] = useState<ThemeName>(() =>
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  )
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
    const granted = readTabLocationGranted()
    setTabLocationOk(granted)
    const savedHome: HomePlace = granted ? { city: prefs?.homeCity, state: prefs?.homeState } : {}
    const locs = granted && prefs?.locations?.length ? prefs.locations : ['World', 'India']
    const topics = prefs?.topics?.length ? prefs.topics : ['Technology', 'Business', 'Sports']
    setHome(savedHome)
    if (prefs?.theme === 'light' || prefs?.theme === 'dark') {
      setTheme(prefs.theme)
      applyTheme(prefs.theme)
    }
    setSelLoc(mergeHomeLocations(locs, savedHome))
    if (prefs?.topics) setSelTopics(new Set(prefs.topics))
    const cached = readCachedEdition([...mergeHomeLocations(locs, savedHome)], topics)
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
    const prev = readPrefs()
    writePrefs({
      topics: [...selTopics],
      onboarded,
      theme,
      locations: tabLocationOk ? [...selLoc] : prev?.locations,
      homeCity: tabLocationOk ? home.city : prev?.homeCity,
      homeState: tabLocationOk ? home.state : prev?.homeState,
    })
  }, [selLoc, selTopics, onboarded, home, theme, tabLocationOk, hydrated])

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

  const applyDetectedHome = (found: HomePlace, replacePreviousHome: boolean) => {
    setHome(prevHome => {
      setSelLoc(locs => {
        const base = new Set(locs)
        if (replacePreviousHome) {
          if (prevHome.city) base.delete(prevHome.city)
          if (prevHome.state) base.delete(prevHome.state)
        }
        return mergeHomeLocations(base, found, !replacePreviousHome && isLegacyDefaultLocations([...locs]))
      })
      return found
    })
  }

  const applyWorldDefault = () => {
    setHome({})
    setSelLoc(new Set(['World', 'India']))
    writeTabLocation('denied')
    setTabLocationOk(false)
  }

  const markTabLocationOk = () => {
    writeTabLocation('granted')
    setTabLocationOk(true)
  }

  const applySavedHome = () => {
    const prefs = readPrefs()
    if (!prefs?.homeCity && !prefs?.homeState) return false
    applyDetectedHome({ city: prefs.homeCity, state: prefs.homeState }, true)
    markTabLocationOk()
    return true
  }

  const detectGen = useRef(0)
  const gpsRetries = useRef(0)
  const usedEarlyDetect = useRef(false)
  const detectInflight = useRef(false)
  const runDetect = (fromRetry = false) => {
    if (detectInflight.current && !fromRetry) return
    if (!fromRetry) gpsRetries.current = 0
    const gen = ++detectGen.current
    detectInflight.current = true
    setDetecting(true)
    const task = !fromRetry && !usedEarlyDetect.current
      ? (usedEarlyDetect.current = true, takeEarlyDetect())
      : detectHomePlace()
    void task
      .then(async found => {
        if (gen !== detectGen.current) return false
        if (found) {
          gpsRetries.current = 0
          applyDetectedHome(found, true)
          markTabLocationOk()
          return false
        }
        const state = await queryGeolocationPermission()
        if (gen !== detectGen.current) return false
        if (state === 'granted' && gpsRetries.current < 1) {
          gpsRetries.current += 1
          runDetectRef.current(true)
          return true
        }
        if (state !== 'granted') applyWorldDefault()
        return false
      })
      .then(retrying => {
        if (gen !== detectGen.current) return
        detectInflight.current = false
        if (!retrying) setDetecting(false)
      })
  }
  const runDetectRef = useRef(runDetect)
  runDetectRef.current = runDetect

  useEffect(() => {
    if (!hydrated) return
    void queryGeolocationPermission().then(state => {
      if (state === 'granted') applySavedHome()
    })
    runDetectRef.current()
    const unsub = subscribeGeolocationPermission(state => {
      if (state === 'granted') {
        applySavedHome()
        runDetectRef.current()
      }
      if (state === 'denied') applyWorldDefault()
    })
    const onReturn = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return
      void queryGeolocationPermission().then(state => {
        if (state === 'granted') {
          applySavedHome()
          if (!readTabLocationGranted()) runDetectRef.current()
        }
      })
    }
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('focus', onReturn)
    return () => {
      unsub()
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('focus', onReturn)
    }
  }, [hydrated])

  const toggleLoc = (loc: string) =>
    setSelLoc(prev => {
      const n = new Set(prev)
      if (n.has(loc)) {
        n.delete(loc)
        if (home.city === loc) setHome({})
        else if (home.state === loc) setHome(h => ({ ...h, state: undefined }))
      } else {
        n.add(loc)
        if ((CITIES as readonly string[]).includes(loc)) {
          const city = loc as City
          const state = CITY_TO_STATE[city]
          setHome({ city, state })
          if (state) n.add(state)
          markTabLocationOk()
        } else if ((STATES as readonly string[]).includes(loc) && !home.city) {
          setHome(h => ({ ...h, state: loc as StateName }))
          markTabLocationOk()
        }
      }
      if (!n.size) n.add('World')
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
    prefetchStoryListen(story)
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

  if (!hydrated) return <div className="min-h-dvh" style={{ background: 'var(--paper)' }} />
  if (screen === 'onboarding-location') {
    return (
      <OnboardingLocation
        selected={selLoc}
        home={home}
        detecting={detecting}
        onToggle={toggleLoc}
        onDetect={() => runDetect()}
        onNext={() => pushRoute('onboarding-topics')}
      />
    )
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
        home={home}
        detecting={detecting}
        theme={theme}
        onNavigate={goTab}
        onRefresh={() => setRefreshNonce(n => n + 1)}
        onToggleTheme={() => {
          const next = theme === 'dark' ? 'light' : 'dark'
          setTheme(next)
          applyTheme(next)
        }}
        refreshing={loading}
      />
      {screen === 'home' && (
        <HomePage
          edition={edition}
          loading={loading}
          error={error}
          home={home}
          onRetry={() => setRefreshNonce(n => n + 1)}
          onStoryTap={handleStoryTap}
        />
      )}
      {screen === 'profile' && (
        <ProfilePage
          locations={[...selLoc]}
          topics={[...selTopics]}
          home={home}
          detecting={detecting}
          fetchedAt={edition.fetchedAt}
          onToggleLoc={toggleLoc}
          onToggleTopic={toggleTopic}
          onDetect={() => runDetect()}
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
