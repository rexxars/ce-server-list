/* eslint-env browser */
;(function () {
  // Transparent 1x1 SVG used when a server has no known country.
  const empty =
    'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMSAxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIHN0eWxlPSJmaWxsOiByZ2JhKDI1NSwgMjU1LCAyNTUsIDApOyI+PC9yZWN0Pjwvc3ZnPg=='

  // Sanity listen endpoint for the `serverList` document. The page is rendered
  // server-side with the current state; this stream keeps it live by pushing the
  // full document on every mutation.
  const listenUrl =
    'https://cneagle.api.sanity.io/v2026-06-03/data/listen/servers' +
    '?query=' +
    encodeURIComponent('*[_id=="serverList"]') +
    '&includeResult=true&includePreviousRevision=false&includeMutations=false'

  const tbody = document.querySelector('tbody')

  const source = new EventSource(listenUrl)
  source.addEventListener('mutation', (event) => {
    let servers
    try {
      servers = JSON.parse(event.data).result.servers
    } catch (err) {
      return
    }

    if (Array.isArray(servers)) {
      renderServers(servers)
    }
  })

  function renderServers(servers) {
    // Sort by `_key` so the order is stable and rows do not shuffle around.
    const sorted = servers.slice().sort((a, b) => a._key.localeCompare(b._key))

    while (tbody.firstChild) {
      tbody.removeChild(tbody.firstChild)
    }

    if (sorted.length === 0) {
      const tr = document.createElement('tr')
      const td = cell('No servers online.', 'empty')
      td.setAttribute('colspan', '7')
      tr.appendChild(td)
      tbody.appendChild(tr)
      return
    }

    sorted.forEach(renderServer)
  }

  function renderServer(server) {
    const {ip, serverPort, version, name, map, maxPlayers, numPlayers, gameType, countryCode} =
      server

    const tr = document.createElement('tr')
    tr.appendChild(flag(countryCode))
    tr.appendChild(cell(name))
    tr.appendChild(cell(gameLink(`${ip}:${serverPort}`)))
    tr.appendChild(cell(`${numPlayers} / ${maxPlayers}`))
    tr.appendChild(cell(map, 'map'))
    tr.appendChild(cell(gameType === 'ctf' ? 'CTF' : gameType, 'mode'))
    tr.appendChild(cell(version, 'version'))

    tbody.appendChild(tr)
  }

  function flag(countryCode) {
    const src = /^[a-z]{2}$/i.test(countryCode || '')
      ? `https://flagcdn.com/${countryCode.toLowerCase()}.svg`
      : empty
    const img = document.createElement('img')
    img.setAttribute('src', src)
    return cell(img, 'flag')
  }

  function gameLink(address) {
    const a = document.createElement('a')
    a.setAttribute('href', `cneagle://${address}`)
    a.setAttribute('rel', 'noreferrer noopener')
    a.appendChild(document.createTextNode(address))
    return a
  }

  function cell(content, className) {
    const td = document.createElement('td')
    if (className) {
      td.setAttribute('class', className)
    }

    if (typeof content === 'string') {
      td.appendChild(document.createTextNode(content))
    } else {
      td.appendChild(content)
    }
    return td
  }
})()
