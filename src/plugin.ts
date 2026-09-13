/**
 * Plugin install path — `app.use(DropzonePlugin)` registers the directive
 * under the kebab-case name `dropzone`.
 *
 * Idempotent under Vue's standard `app.use` semantics (Vue caches installed
 * plugins per app instance, so a double-install is a no-op).
 */
import type { App, Plugin } from 'vue'
import { vDropzone } from './directive'

/**
 * The conventional Vue directive name this package registers under. Useful for
 * end-to-end test introspection (`app._context.directives[DIRECTIVE_NAME]`)
 * and for callers that prefer to install the directive manually via
 * `app.directive(DIRECTIVE_NAME, vDropzone)`.
 */
export const DIRECTIVE_NAME = 'dropzone' as const

export const DropzonePlugin: Plugin = {
  install(app: App) {
    app.directive(DIRECTIVE_NAME, vDropzone)
  },
}
