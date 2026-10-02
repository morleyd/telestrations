import { test, expect } from '@playwright/test'
import { waitingOn } from '../../src/services/progress.js'

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
