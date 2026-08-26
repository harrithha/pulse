import assert from 'node:assert/strict'
import { test } from 'node:test'
import { matchHomePlaceFromCoords } from '../src/lib/places.ts'

test('maps GPS inside a metro to that city', () => {
  assert.deepEqual(matchHomePlaceFromCoords(18.52, 73.86), { city: 'Pune', state: 'Maharashtra' })
  assert.equal(matchHomePlaceFromCoords(19.08, 72.88).city, 'Mumbai')
  assert.equal(matchHomePlaceFromCoords(28.61, 77.21).city, 'Delhi')
})

test('does not pin a far-away city', () => {
  assert.deepEqual(matchHomePlaceFromCoords(26.91, 75.79), {})
  assert.deepEqual(matchHomePlaceFromCoords(40.71, -74.01), {})
})
