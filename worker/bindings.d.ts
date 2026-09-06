// The starter database helper is retained for future milestones. Phase one has
// no D1 binding; callers must keep the existing runtime availability guard.
declare namespace Cloudflare {
  interface Env { DB?: D1Database }
}
