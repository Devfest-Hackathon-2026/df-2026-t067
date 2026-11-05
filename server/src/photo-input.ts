import sharp from 'sharp'
import { HttpError, invalidInput } from './errors'
import { tooLarge } from './request-body'

export interface PhotoInput { bytes: Buffer; mimeType: string }
export interface PreparedPhoto { bytes: Buffer; mimeType: 'image/jpeg'; width: number; height: number }

export async function preparePhoto(input: PhotoInput): Promise<PreparedPhoto> {
  if (!input || !Buffer.isBuffer(input.bytes) || input.bytes.length === 0 ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(input.mimeType)) invalidInput()
  if (input.bytes.length > 4 * 1024 * 1024) throw tooLarge()
  try {
    const image = sharp(input.bytes, { failOn: 'warning', limitInputPixels: 16_000_000, limitInputChannels: 4, animated: true }).timeout({ seconds: 3 })
    const meta = await image.metadata()
    const format = input.mimeType.slice('image/'.length)
    if (meta.format !== format || !meta.width || !meta.height || (meta.pages ?? 1) !== 1) invalidInput()
    const result = await image.autoOrient().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).toColourspace('srgb').jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true })
    if (result.data.length > 2 * 1024 * 1024) throw tooLarge()
    return { bytes: result.data, mimeType: 'image/jpeg', width: result.info.width, height: result.info.height }
  } catch (error) {
    if (error instanceof HttpError) throw error
    // Do not expose native decoder errors or source metadata to a caller/log.
    invalidInput()
  }
}
