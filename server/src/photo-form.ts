import type { IncomingMessage } from 'node:http'
import { HttpError, invalidInput } from './errors'
import { readBody, tooLarge } from './request-body'

export async function readPhotoForm(request: IncomingMessage): Promise<{ image: Buffer; mimeType: string; metadata: string }> {
  const count = request.rawHeaders.filter((_, index) => index % 2 === 0)
    .filter((name) => name.toLowerCase() === 'content-type').length
  if (count > 1) invalidInput()
  const contentType = request.headers['content-type'] ?? ''
  const encoding = request.headers['content-encoding']
  if (!/^multipart\/form-data\s*;/i.test(contentType) || (encoding !== undefined && encoding.toLowerCase() !== 'identity')) {
    throw new HttpError(415, 'HTTP_ERROR', '写真と撮影情報をmultipart形式で送信してください。')
  }
  const bytes = await readBody(request, 4 * 1024 * 1024 + 16 * 1024)
  let form: FormData
  try {
    form = await new Request('http://localhost/photo-input', { method: 'POST', headers: { 'Content-Type': contentType }, body: new Uint8Array(bytes) }).formData()
  } catch { invalidInput() }
  const fields: string[] = []
  form.forEach((_, name) => fields.push(name))
  if (fields.sort().join(',') !== 'metadata,photo') invalidInput()
  const photo = form.get('photo')
  const metadata = form.get('metadata')
  if (!(photo instanceof File) || !photo.size || typeof metadata !== 'string') invalidInput()
  if (photo.size > 4 * 1024 * 1024 || Buffer.byteLength(metadata) > 4096) throw tooLarge()
  const mime = photo.type.toLowerCase()
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new HttpError(415, 'HTTP_ERROR', 'JPEG・PNG・WebPで送信してください。')
  const image = Buffer.from(await photo.arrayBuffer())
  const matches = mime === 'image/jpeg' ? image.length >= 4 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff
    : mime === 'image/png' ? image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : image.length >= 12 && image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP'
  if (!matches) invalidInput()
  return { image, mimeType: mime, metadata }
}
