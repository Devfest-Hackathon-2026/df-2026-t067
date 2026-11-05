export interface AuthUser { uid: string; displayName: string | null }
export type AuthSnapshot =
  | { status: 'unconfigured' | 'checking' | 'signed-out'; user: null }
  | { status: 'unavailable'; user: null; message: string }
  | { status: 'signed-in'; user: AuthUser }

export interface AuthClient {
  getSnapshot(): AuthSnapshot
  subscribe(listener: () => void): () => void
  signInWithGoogle(): Promise<void>
  signOut(): Promise<void>
  getIdToken(): Promise<string | null>
}
