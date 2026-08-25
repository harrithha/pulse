export type Tab = 'home' | 'profile'

export type Screen =
  | 'onboarding-location'
  | 'onboarding-topics'
  | 'home'
  | 'profile'
  | 'story'

export interface Publisher {
  name: string
  url: string
}

export interface StoryCard {
  id: string
  headline: string
  summary: string
  category: string
  time: string
  publishedAt: string
  sources: number
  image?: string
  url: string
  publishers: Publisher[]
  whatHappened: string[]
  whyItMatters: string
  shelf: string
  body?: string[]
}

export interface Shelf {
  label: string
  stories: StoryCard[]
}

export interface BriefSection {
  id: string
  label: string
  sub: string
  script: string
  dur: string
  storyIds: string[]
}

export interface NewsPayload {
  fetchedAt: string
  shelves: Shelf[]
  highlights: StoryCard[]
  brief: {
    sections: BriefSection[]
    storyCount: number
    minutes: number
    script: string
  }
}

export interface Session {
  name: string
  email: string
  loggedInAt: string
}
