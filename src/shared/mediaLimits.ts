// Photo limits shared by connected admin screens, API clients and server intake.
export const PHOTO_UPLOAD_MAX_BYTES = 4 * 1024 * 1024
export const NORMALIZED_PHOTO_MAX_BYTES = 2 * 1024 * 1024
export const NORMALIZED_PHOTO_MAX_EDGE_PX = 1600
export const PHOTO_UPLOAD_MIME_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp']
export const PHOTO_UPLOAD_ACCEPT = PHOTO_UPLOAD_MIME_TYPES.join(',')
// Separate multipart transport and metadata budgets; neither is a photo limit.
export const PHOTO_MULTIPART_OVERHEAD_MAX_BYTES = 16 * 1024
export const PHOTO_METADATA_MAX_BYTES = 4096
// Standalone demo drafts retain their existing, larger upload allowance.
export const DEMO_DRAFT_PHOTO_MAX_BYTES = 5 * 1024 * 1024
