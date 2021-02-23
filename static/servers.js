/* eslint-env browser */
;(function () {
  const empty =
    'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMSAxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIHN0eWxlPSJmaWxsOiByZ2JhKDI1NSwgMjU1LCAyNTUsIDApOyI+PC9yZWN0Pjwvc3ZnPg=='
  const table = document.querySelector('table')
  const tbody = document.querySelector('tbody')

  fetchServers()
  setInterval(fetchServers, 15000)

  function fetchServers() {
    fetch('/api')
      .then((res) => res.json())
      .then(renderServers)
  }

  function renderServers(data) {
    table.removeAttribute('data-state')

    while (tbody.firstChild) {
      tbody.removeChild(tbody.firstChild)
    }

    data.servers.forEach(renderServer)
  }

  function renderServer(server) {
    const {
      ip,
      serverPort,
      version,
      name,
      map,
      maxPlayers,
      numPlayers,
      gameType,
      countryCode,
    } = server

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
    const svg = countryCode ? `/flags/${countryCode.toLowerCase()}.svg` : empty
    const img = document.createElement('img')
    img.setAttribute('src', svg)
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
