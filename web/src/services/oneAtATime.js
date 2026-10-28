// A component method that does nothing while a call of it is still running.
//
// One Enter in a form runs its handler several times: SetUsername emits
// @username on keydown and keyup, its submit bubbles to the page's own form,
// and other fields call the handler from their @keyup.enter too. The first
// call wins and the rest do nothing, rather than race it with a second create
// for the same player (or, for New Game, a second game).
export function oneAtATime(method) {
  const running = new WeakSet()
  return async function (...args) {
    if (running.has(this)) return
    running.add(this)
    try {
      return await method.apply(this, args)
    } finally {
      running.delete(this)
    }
  }
}
