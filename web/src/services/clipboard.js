// Copies text to the clipboard; true if it worked.
//
// navigator.clipboard is only there on a secure page (https, or localhost),
// and `make run` serves the phones on the Wi-Fi plain http. There, fall back
// to selecting the text and copying it the old way.
export async function copyText(text) {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // refused (no permission, page not focused): try the old way
    }
  }
  return copyBySelecting(text)
}

function copyBySelecting(text) {
  // getSelection() can be null (a document with no active browsing
  // context): that's a copy that didn't work, like any other failure.
  const selection = window.getSelection()
  if (!selection) return false
  const span = document.createElement("span")
  span.textContent = text
  // Out of sight, but selectable wherever the page turns selection off.
  span.style.cssText = "position: fixed; top: 0; clip: rect(0, 0, 0, 0); white-space: pre; user-select: text; -webkit-user-select: text;"
  document.body.appendChild(span)
  try {
    const range = document.createRange()
    range.selectNodeContents(span)
    selection.removeAllRanges()
    selection.addRange(range)
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    selection.removeAllRanges()
    span.remove()
  }
}
