// fetch, but it resolves only once the whole body is in.
//
// The PocketBase SDK reads a response's body after fetch resolves, and if that
// read fails it carries on as if the body were empty. So a request it cancels
// (see the note on auto-cancellation in index.js) after the headers are in but
// before the body is resolves as a success with no data: a list read comes back
// as an empty list, and the page shows nothing until the next read lands. Read
// here, inside fetch, a cancelled body rejects like any other cancellation.
export async function fetchWhole(url, init) {
  const resp = await fetch(url, init)
  const body = await resp.arrayBuffer()
  // A 204 (the realtime subscription's answer) can't be given a body, not even
  // an empty one.
  const whole = new Response(body.byteLength ? body : null, {
    status: resp.status,
    statusText: resp.statusText,
    headers: resp.headers,
  })
  // The SDK puts it in its errors.
  Object.defineProperty(whole, "url", { value: resp.url })
  return whole
}
