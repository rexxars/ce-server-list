/**
 * Guards the server list against non-routable addresses. A heartbeat (or a
 * stale backup entry) carrying a LAN / loopback / reserved IP is useless to
 * other players - nobody on the public internet can reach `192.168.x.x` - so we
 * never add such hosts to the list.
 *
 * The heartbeat socket is UDP/IPv4, so addresses are effectively IPv4 (possibly
 * in IPv4-mapped IPv6 form), but the IPv6 cases are handled defensively too.
 */
export function isPublicIp(ip: string): boolean {
  const normalized = ip.trim().toLowerCase()

  // IPv4-mapped IPv6 (e.g. `::ffff:192.168.1.1`) - judge by the embedded IPv4.
  const mapped = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) {
    return isPublicIpv4(mapped[1])
  }

  if (normalized.includes(':')) {
    return isPublicIpv6(normalized)
  }

  return isPublicIpv4(normalized)
}

function isPublicIpv4(ip: string): boolean {
  const octets = ip.split('.')
  if (octets.length !== 4) {
    return false
  }

  const parts: number[] = []
  for (const octet of octets) {
    // Reject empty parts, non-digits and out-of-range values (`0`-padded ok).
    if (!/^\d{1,3}$/.test(octet)) {
      return false
    }
    const value = Number(octet)
    if (value > 255) {
      return false
    }
    parts.push(value)
  }

  const [a, b] = parts

  if (a === 0) return false // 0.0.0.0/8 "this network" / unspecified
  if (a === 10) return false // 10.0.0.0/8 private
  if (a === 127) return false // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return false // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return false // 172.16.0.0/12 private
  if (a === 192 && b === 168) return false // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return false // 100.64.0.0/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return false // 198.18.0.0/15 benchmarking
  if (a >= 224) return false // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + broadcast

  // Documentation ranges (TEST-NET-1/2/3) - never real hosts.
  if (a === 192 && b === 0 && parts[2] === 2) return false
  if (a === 198 && b === 51 && parts[2] === 100) return false
  if (a === 203 && b === 0 && parts[2] === 113) return false

  return true
}

function isPublicIpv6(ip: string): boolean {
  if (ip === '::' || ip === '::1') return false // unspecified / loopback

  // fc00::/7 unique-local and fe80::/10 link-local.
  if (/^f[cd]/.test(ip)) return false
  if (/^fe[89ab]/.test(ip)) return false

  return true
}
