// The faces a player can pick for their avatar: the bundled SVGs, by name
// ("glee"). A player's avatar is one of these names, or "" for their
// initials. Only this markup is ever put in the page as HTML: the avatar
// field is the player's to write.
//
// TODO It'll take editing all the SVGs, but consider editing their stroke
// color.
const files = import.meta.glob('@/assets/avatars/*.svg', { query: '?raw', import: 'default', eager: true })

export const FACES = new Map(Object.entries(files).map(([path, svg]) => [path.match(/([^/]+)\.svg$/)[1], svg]))
