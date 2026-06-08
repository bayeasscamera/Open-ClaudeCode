(function () {
  const DEFAULT_WPM = 600
  const MIN_WPM = 250
  const MAX_WPM = 900

  function wordsFromText(value) {
    return String(value || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[#>*_\-[\]()]/g, ' ')
      .split(/\s+/)
      .map(word => word.trim())
      .filter(Boolean)
  }

  function pivotIndex(word) {
    const length = word.length
    if (length <= 1) return 0
    if (length <= 5) return 1
    if (length <= 9) return 2
    if (length <= 13) return 3
    return 4
  }

  function createSpeedReader({ doc = document } = {}) {
    let timer = null
    let words = []
    let index = 0
    let wpm = DEFAULT_WPM
    let overlay = null
    let wordNode = null
    let progress = null

    function ensureOverlay() {
      if (overlay) return overlay
      overlay = doc.createElement('div')
      overlay.className = 'speedReaderOverlay hidden'
      overlay.innerHTML = [
        '<div class="speedReaderPanel" role="dialog" aria-modal="true" aria-label="Lecture rapide">',
        '<div class="speedReaderHeader"><strong>Lecture rapide</strong><span></span><button type="button" class="close">×</button></div>',
        '<div class="speedReaderWord" aria-live="polite"></div>',
        '<div class="speedReaderProgress"><span></span></div>',
        '<div class="speedReaderControls">',
        '<button type="button" class="prev">Précédent</button>',
        '<button type="button" class="play">Pause</button>',
        '<button type="button" class="next">Suivant</button>',
        '<label>Vitesse <input type="range" min="250" max="900" step="50" value="600" /></label>',
        '</div>',
        '</div>',
      ].join('')
      wordNode = overlay.querySelector('.speedReaderWord')
      progress = overlay.querySelector('.speedReaderProgress span')
      overlay.querySelector('.close').addEventListener('click', close)
      overlay.querySelector('.prev').addEventListener('click', () => step(-1))
      overlay.querySelector('.next').addEventListener('click', () => step(1))
      overlay.querySelector('.play').addEventListener('click', toggle)
      overlay.querySelector('input').addEventListener('input', event => {
        wpm = Number(event.target.value) || DEFAULT_WPM
        restartTimer()
        renderWord()
      })
      doc.body.appendChild(overlay)
      return overlay
    }

    function renderWord() {
      if (!wordNode) return
      const word = words[index] || ''
      const pivot = pivotIndex(word)
      wordNode.replaceChildren()
      const before = doc.createElement('span')
      const center = doc.createElement('b')
      const after = doc.createElement('span')
      before.textContent = word.slice(0, pivot)
      center.textContent = word[pivot] || ''
      after.textContent = word.slice(pivot + 1)
      wordNode.append(before, center, after)
      overlay.querySelector('.speedReaderHeader span').textContent = `${index + 1}/${words.length} · ${wpm} WPM`
      progress.style.width = words.length ? `${Math.round(((index + 1) / words.length) * 100)}%` : '0%'
    }

    function delayMs() {
      const word = words[index] || ''
      const punctuationPause = /[.!?;:]$/.test(word) ? 1.75 : /[,)]$/.test(word) ? 1.25 : 1
      return Math.max(35, Math.round((60000 / wpm) * punctuationPause))
    }

    function tick() {
      if (index >= words.length - 1) {
        pause()
        return
      }
      index += 1
      renderWord()
      restartTimer()
    }

    function restartTimer() {
      if (!timer) return
      clearTimeout(timer)
      timer = setTimeout(tick, delayMs())
    }

    function play() {
      if (!words.length || timer) return
      overlay.querySelector('.play').textContent = 'Pause'
      timer = setTimeout(tick, delayMs())
    }

    function pause() {
      if (timer) clearTimeout(timer)
      timer = null
      overlay?.querySelector('.play') && (overlay.querySelector('.play').textContent = 'Lire')
    }

    function toggle() {
      if (timer) pause()
      else play()
    }

    function step(delta) {
      pause()
      index = Math.max(0, Math.min(words.length - 1, index + delta))
      renderWord()
    }

    function open(text) {
      words = wordsFromText(text)
      if (!words.length) return false
      index = 0
      ensureOverlay()
      overlay.classList.remove('hidden')
      renderWord()
      play()
      return true
    }

    function close() {
      pause()
      overlay?.classList.add('hidden')
    }

    return { close, open, pause, wordsFromText }
  }

  window.OPCSpeedReader = {
    createSpeedReader,
    pivotIndex,
    wordsFromText,
  }
})()
