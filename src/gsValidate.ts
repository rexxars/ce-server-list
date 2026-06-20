// GameSpy "secure"/"validate" challenge–response, reverse-engineered from
// Codename Eagle's ce.exe. A querier sends `\secure\<challenge>` (alone or
// appended to a `\status\`/`\basic\` query) to the server's QUERY port (4711),
// and the server appends `\validate\<response>` to its reply, where the response
// is `base64(gs_encrypt(challenge, secretKey))`.
//
// Extracted statically from ce.exe 1.41 and CONFIRMED against a live 1.43 host:
// `\secure\ABCDEF` → `\validate\XY7mYbEq`, matching computeValidate('ABCDEF').
//   - gamename:   "cneagle"
//   - secret key: "HNvEAc"  (bytes 48 4E 76 45 41 63 at .data:0x557b80, written
//                            during GameSpy init)
//   - transform:  GameSpy `gs_encrypt` (0x4245d0) — a modified RC4 whose
//                 keystream folds in each plaintext byte — followed by standard
//                 base64 (encoder 0x4244e0, alphabet map 0x4245a0).
//
// NOTE: reference crypto — NOT used in the master's trust path. `ce.exe` runs
// `\secure\` on the query port (not the UDP heartbeat socket), and the key is
// public, so a valid `\validate\` proves only "knows a published constant". The
// master instead trusts a server by querying its advertised `<ip>:<queryPort>`
// back (see query.ts): answering `\status\` like a real CE host is a strictly
// stronger check. Kept as the authoritative `gs_encrypt` description (cited by
// the cemod RE docs) and the building block should a `\secure\` gate ever be
// wanted in the query path.

/** The per-title GameSpy secret key baked into ce.exe for Codename Eagle. */
export const CE_SECRET_KEY = 'HNvEAc'

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const CHALLENGE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const VALIDATE_TOKEN = '\\validate\\'

/**
 * GameSpy `gs_encrypt`: a modified RC4. The key schedule is textbook RC4, but
 * the keystream loop folds each plaintext byte into the `x` index
 * (`x = (x + data[i] + 1) mod 256`), so it is self-synchronizing rather than a
 * fixed keystream. Encrypts `data` in place.
 */
function gsEncrypt(data: Uint8Array, key: string): void {
  const state = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    state[i] = i
  }

  // Key scheduling.
  let y = 0
  let keyIndex = 0
  for (let i = 0; i < 256; i++) {
    y = (y + key.charCodeAt(keyIndex) + state[i]) & 0xff
    keyIndex = (keyIndex + 1) % key.length
    const swapped = state[i]
    state[i] = state[y]
    state[y] = swapped
  }

  // Keystream with plaintext feedback.
  let x = 0
  y = 0
  for (let i = 0; i < data.length; i++) {
    x = (x + data[i] + 1) & 0xff
    y = (state[x] + y) & 0xff
    const swapped = state[x]
    state[x] = state[y]
    state[y] = swapped
    data[i] ^= state[(state[x] + state[y]) & 0xff]
  }
}

/**
 * Standard base64 over raw bytes, but always emitting whole 4-character groups
 * with no `=` padding (zero-filling a short final group) — exactly how ce.exe's
 * encoder behaves.
 */
function gsEncode(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    out += BASE64[b0 >> 2]
    out += BASE64[((b0 & 0x03) << 4) | (b1 >> 4)]
    out += BASE64[((b1 & 0x0f) << 2) | (b2 >> 6)]
    out += BASE64[b2 & 0x3f]
  }
  return out
}

/**
 * Computes the `\validate\` response a CE server returns for a given `\secure\`
 * challenge. The reply is `base64(gs_encrypt(challenge, secretKey))`.
 */
export function computeValidate(challenge: string, secretKey: string = CE_SECRET_KEY): string {
  const data = new TextEncoder().encode(challenge)
  gsEncrypt(data, secretKey)
  return gsEncode(data)
}

/**
 * Generates a challenge to embed in `\basic\\secure\<challenge>`. GameSpy uses 6
 * printable characters; the value is opaque to the client, which just echoes it
 * back through the transform. The alphabet excludes `\` so it cannot break the
 * key/value framing.
 */
export function randomChallenge(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  let out = ''
  for (const byte of bytes) {
    out += CHALLENGE_ALPHABET[byte % CHALLENGE_ALPHABET.length]
  }
  return out
}

export type ValidateParse = {type: 'incomplete'} | {type: 'validate'; response: string}

/**
 * Extracts the response from a (possibly partial) `\validate\<response>\final\`
 * frame. Returns `incomplete` until both the token and a trailing `\` delimiter
 * have arrived; the base64 response never contains a backslash, so the value
 * runs from after `\validate\` up to the next `\`.
 */
export function parseValidateResponse(buffer: Buffer): ValidateParse {
  const text = buffer.toString('utf8')
  const tokenAt = text.indexOf(VALIDATE_TOKEN)
  if (tokenAt === -1) {
    return {type: 'incomplete'}
  }

  const valueStart = tokenAt + VALIDATE_TOKEN.length
  const valueEnd = text.indexOf('\\', valueStart)
  if (valueEnd === -1) {
    return {type: 'incomplete'}
  }

  return {type: 'validate', response: text.slice(valueStart, valueEnd)}
}

/** Verifies a server's `\validate\` response against the expected value. */
export function isValidResponse(
  challenge: string,
  response: string,
  secretKey: string = CE_SECRET_KEY,
): boolean {
  return response === computeValidate(challenge, secretKey)
}
