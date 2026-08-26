import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CITIES,
  CITY_TO_STATE,
  citiesInState,
  cityKeepsStory,
  hitsFollowedNarrowerPlace,
  isLegacyDefaultLocations,
  matchHomePlaceFromCoords,
  mergeHomeLocations,
  shelfGeoRank,
} from '../src/lib/places.ts'

test('maps GPS inside a metro to that city', () => {
  assert.deepEqual(matchHomePlaceFromCoords(18.52, 73.86), { city: 'Pune', state: 'Maharashtra' })
  assert.equal(matchHomePlaceFromCoords(19.08, 72.88).city, 'Mumbai')
  assert.equal(matchHomePlaceFromCoords(28.61, 77.21).city, 'Delhi')
})

test('does not treat a far-away city as the user home', () => {
  assert.equal(matchHomePlaceFromCoords(9.93, 76.27).city, undefined)
})

test('city news is not treated as belonging on a broader followed row', () => {
  assert.deepEqual(citiesInState('Tamil Nadu'), ['Chennai'])
  assert.deepEqual(citiesInState('Maharashtra').sort(), ['Mumbai', 'Pune'].sort())
  assert.equal(
    hitsFollowedNarrowerPlace('Actor Madhavan farm in Chennai', 'Tamil Nadu', ['Chennai', 'Tamil Nadu']),
    true,
  )
  assert.equal(
    hitsFollowedNarrowerPlace('Coimbatore water shortage', 'Tamil Nadu', ['Chennai', 'Tamil Nadu']),
    false,
  )
  assert.equal(
    hitsFollowedNarrowerPlace('Pune metro phase 3', 'India', ['Pune', 'Maharashtra', 'India']),
    true,
  )
  assert.equal(
    hitsFollowedNarrowerPlace('Parliament passes new bill in Delhi', 'World', ['India', 'World']),
    false,
  )
  assert.equal(shelfGeoRank('My City · Pune'), 0)
  assert.equal(shelfGeoRank('Maharashtra'), 1)
  assert.equal(shelfGeoRank('India'), 2)
  assert.equal(shelfGeoRank('World'), 3)

  for (const [city, state] of Object.entries(CITY_TO_STATE)) {
    const local = `${city} local flooding overnight`
    assert.equal(hitsFollowedNarrowerPlace(local, state, [city, state]), true, `${city} stays off ${state}`)
    assert.equal(hitsFollowedNarrowerPlace(local, 'India', [city, state, 'India']), true, `${city} stays off India`)
    assert.equal(hitsFollowedNarrowerPlace(local, 'World', [city, 'World']), true, `${city} stays off World`)
  }
  for (const city of CITIES.filter(c => !CITY_TO_STATE[c])) {
    const local = `${city} rains disrupt commute`
    assert.equal(hitsFollowedNarrowerPlace(local, 'India', [city, 'India']), true, `${city} stays off India`)
    assert.equal(hitsFollowedNarrowerPlace(local, 'World', [city, 'World']), true, `${city} stays off World`)
  }
  assert.equal(cityKeepsStory('Tamil Nadu VB-G RAM G wage hike', 'Chennai', ['Chennai']), true)
  assert.equal(cityKeepsStory('Tamil Nadu VB-G RAM G wage hike', 'Chennai', ['Chennai', 'Tamil Nadu']), false)
  assert.equal(cityKeepsStory('Chennai rains flood roads', 'Chennai', ['Chennai', 'Tamil Nadu']), true)
})

test('location allow and block pick the same rows a user would see', () => {
  const blocked = [...mergeHomeLocations([], {})].sort()
  assert.deepEqual(blocked, ['India', 'World'])

  const allowed = [...mergeHomeLocations(['World', 'India'], { city: 'Pune', state: 'Maharashtra' })].sort()
  assert.deepEqual(allowed, ['India', 'Maharashtra', 'Pune', 'World'])

  const extras = [...mergeHomeLocations(['Pune', 'Maharashtra', 'India', 'World', 'Chennai'], { city: 'Pune', state: 'Maharashtra' })]
  assert.ok(extras.includes('Pune'))
  assert.ok(extras.includes('Chennai'))
  assert.ok(extras.includes('Maharashtra'))

  assert.equal(isLegacyDefaultLocations(['Pune', 'Maharashtra', 'India', 'World']), true)
  const firstAllowElsewhere = [...mergeHomeLocations(['Pune', 'Maharashtra', 'India', 'World'], { city: 'Chennai', state: 'Tamil Nadu' }, true)].sort()
  assert.deepEqual(firstAllowElsewhere, ['Chennai', 'India', 'Tamil Nadu', 'World'])
})
