import type { FirebaseOptions } from 'firebase/app'

export interface FirebaseWebConfig extends FirebaseOptions {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
}
export type FirebaseConfiguration =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'configured'; config: FirebaseWebConfig }

export const FIREBASE_ENV_NAMES = [
  'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_APP_ID',
] as const

export function readFirebaseConfig(env: Readonly<Record<string, unknown>>): FirebaseConfiguration {
  const values = FIREBASE_ENV_NAMES.map((name) => env[name])
  if (values.every((value) => value === undefined || (typeof value === 'string' && !value.trim()))) return { kind: 'missing' }
  if (values.some((value) => typeof value !== 'string' || !value.trim())) return { kind: 'invalid' }
  const [apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId] = values.map((value) => (value as string).trim())
  if (!/^[a-zA-Z0-9.-]+$/.test(authDomain) || authDomain.includes('..') ||
    authDomain.startsWith('.') || authDomain.endsWith('.')) return { kind: 'invalid' }
  return { kind: 'configured', config: { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId } }
}
