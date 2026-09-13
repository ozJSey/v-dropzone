/**
 * Build entry point — re-exports the public surface from `src/`.
 *
 * The split keeps each concern in a single-purpose module (types / constants /
 * files / validate / state / upload / upload-control / process / picker /
 * paste / drag / api / directive / plugin) without changing the bundle: tsup
 * follows this entry and emits the same minified file. See ARCHITECTURE.md
 * for the module map.
 */
export { vDropzone, default, DIRECTIVE_NAME, DropzonePlugin } from './src'
export type {
  DropzoneApi,
  DropzoneApiRef,
  DropzoneBinding,
  DropzoneHandler,
  DropzoneOptions,
  DropzonePasteScope,
  DropzoneRejectEvent,
  DropzoneRejectReason,
  DropzoneState,
  UploadConfig,
  UploadError,
  UploadFn,
  UploadMethod,
  UploadProgressEvent,
  UploadResult,
  UploadValueOrFn,
} from './src'
