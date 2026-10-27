import { test, expect } from '@playwright/test'
import { gameProgress, playerTurns, waitingOn } from '../../src/services/progress.js'

// How the waiting screen and the review's list put a row of the progress view
// into words. No page is opened.

const USERS = { a: { username: 'alpha' }, b: { username: 'bravo' } }

test('a story says who it is waiting on, or that it is done', () => {
  expect(waitingOn({ next_user_id: 'b' }, USERS, 'a')).toBe('Waiting on bravo')
  expect(waitingOn({ next_user_id: 'a' }, USERS, 'a')).toBe('Waiting on you')
  // Someone who isn't playing (they opened the link) is never "you".
  expect(waitingOn({ next_user_id: 'a' }, USERS, '')).toBe('Waiting on alpha')
  // The players can still be on their way (the review starts with none).
  expect(waitingOn({ next_user_id: 'a' }, null, '')).toBe('Waiting on someone')
  // The view has nobody next once a story has had its last turn, or the game
  // is over.
  expect(waitingOn({ next_user_id: '' }, USERS, 'a')).toBe('Done')
  expect(waitingOn({ next_user_id: null }, USERS, '')).toBe('Done')
})

// A row of the progress view for a game of `players`, each story going round
// `rounds` times (endless: no total).
function row(taken, { players = 4, rounds = 1, endless = false, next = 'a' } = {}) {
  return {
    turns_taken: taken,
    total_players: players,
    total_turns: endless ? null : players * rounds,
    next_user_id: next,
  }
}

test('the game says how far it is, across all its stories', () => {
  // 4 players, 2 rounds: 4 stories of 8 turns, 32 in all; 6 + 8 + 2 + 0 taken.
  // The finished story has nobody next.
  const rows = [row(6, { rounds: 2 }), row(8, { rounds: 2, next: '' }), row(2, { rounds: 2 }), row(0, { rounds: 2 })]
  expect(gameProgress(rows)).toEqual({ label: 'Game 50% done', percent: 50 })
  // Rounded down: 1 of 3 turns
  expect(gameProgress([row(1, { players: 3 }), row(0, { players: 3 }), row(0, { players: 3 })]))
    .toEqual({ label: 'Game 11% done', percent: 11 })
  // Nothing read yet
  expect(gameProgress([])).toBe(null)
  expect(gameProgress(null)).toBe(null)
})

test('a story not started yet counts at its full total, so the percent never jumps back', () => {
  // 4 players, two of them haven't opened the game: their stories have no row
  // yet. 2 + 1 taken of 16, not of 8.
  expect(gameProgress([row(2), row(1)]).percent).toBe(Math.floor((3 / 16) * 100))
  // And when one appears, with nothing taken, it stays where it was.
  expect(gameProgress([row(2), row(1), row(0)]).percent).toBe(Math.floor((3 / 16) * 100))
})

test('skipped turns count as taken', () => {
  // The view counts every turn in the story, skipped (or timed out) or not:
  // a story whose last two turns were skipped has its 4 of 4 like any other.
  const rows = [row(4, { next: '' }), row(4, { next: '' }), row(3), row(3)]
  expect(gameProgress(rows)).toEqual({ label: 'Game 87% done', percent: 87 })
})

test('the game is done once no story is waiting on anyone, and not before', () => {
  // Every turn taken
  expect(gameProgress([row(3, { players: 3, next: '' }), row(3, { players: 3, next: '' }),
    row(3, { players: 3, next: '' })])).toEqual({ label: 'Game done', percent: 100 })
  // End Game: the view has nobody next on any story, however far they got
  expect(gameProgress([row(1, { next: '' }), row(2, { next: '' })])).toEqual({ label: 'Game done', percent: 100 })
  // A dropped player who never opened the game never has a story: the others
  // finishing is the end of it.
  expect(gameProgress([row(4, { next: '' }), row(4, { next: '' }), row(4, { next: '' })]).percent).toBe(100)
  // One turn short is 99%, never a rounded-up 100%.
  const rows = Array.from({ length: 10 }, () => row(20, { players: 10, rounds: 2, next: '' }))
  rows[0] = row(19, { players: 10, rounds: 2 })
  expect(gameProgress(rows)).toEqual({ label: 'Game 99% done', percent: 99 })
})

test('an endless game has no percent: it says the turns so far, then done', () => {
  expect(gameProgress([row(5, { endless: true }), row(4, { endless: true })]))
    .toEqual({ label: 'Game: 9 turns so far', percent: null })
  expect(gameProgress([row(1, { endless: true }), row(0, { endless: true })]))
    .toEqual({ label: 'Game: 1 turn so far', percent: null })
  // After End Game
  expect(gameProgress([row(5, { endless: true, next: '' }), row(4, { endless: true, next: '' })]))
    .toEqual({ label: 'Game done', percent: 100 })
})

// A row of the game's players: turns taken, skipped among them, of total
// (endless: none).
function player(turns, skipped = 0, total = 8, extra = {}) {
  return { turns, skipped, total_turns: total, has_story: true, dropped: false, finished: false, ...extra }
}

test('a player\'s bar shows the turns they took and, after them, the turns skipped for them', () => {
  expect(playerTurns(player(5, 2))).toEqual({ label: '5 / 8', done: 37.5, skipped: 25, status: '', skippedNote: '2 skipped' })
  expect(playerTurns(player(3))).toEqual({ label: '3 / 8', done: 37.5, skipped: 0, status: '', skippedNote: '' })
  // Every turn so far skipped
  expect(playerTurns(player(2, 2, 4))).toMatchObject({ done: 0, skipped: 50, skippedNote: '2 skipped' })
  // Never past the end, whatever the counts
  const over = playerTurns(player(9, 3, 8))
  expect(over.done + over.skipped).toBe(100)
  expect(playerTurns(player(2, 5, 8))).toMatchObject({ done: 0, skipped: 25, skippedNote: '2 skipped' })
  // Nothing to take (no stories yet)
  expect(playerTurns(player(0, 0, 0))).toMatchObject({ label: '0 / 0', done: 0, skipped: 0 })
})

test('a player\'s note says if they\'re done, dropped or not started yet', () => {
  expect(playerTurns(player(8, 1, 8, { finished: true }))).toMatchObject({ status: 'Done', skippedNote: '1 skipped' })
  // A dropped player is finished too; dropped is what to say
  expect(playerTurns(player(3, 3, 8, { dropped: true, finished: true })))
    .toMatchObject({ status: 'Dropped', skippedNote: '3 skipped' })
  expect(playerTurns(player(0, 0, 8, { has_story: false }))).toMatchObject({ status: 'Not started yet' })
  // Turns on others' stories before their own is open: they've started
  expect(playerTurns(player(1, 1, 8, { has_story: false }))).toMatchObject({ status: '', skippedNote: '1 skipped' })
})

test('in an endless game a player has a count of turns, the bars against the most anyone has', () => {
  expect(playerTurns(player(6, 2, null), 8)).toEqual({ label: '6 turns', done: 50, skipped: 25, status: '', skippedNote: '2 skipped' })
  expect(playerTurns(player(1, 0, null), 8)).toMatchObject({ label: '1 turn', done: 12.5 })
  expect(playerTurns(player(0, 0, null), 0)).toMatchObject({ label: '0 turns', done: 0, skipped: 0 })
})
