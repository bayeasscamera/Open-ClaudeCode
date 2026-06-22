/**
 * sessionBanner.js
 * Gère l'affichage de la bannière de reprise de session CLI.
 */

window.createSessionBanner = function ({ bannerElement, onResume, onDismiss }) {
  let currentSessions = []

  function render() {
    if (!currentSessions.length) {
      bannerElement.classList.add('hidden')
      bannerElement.style.display = 'none'
      bannerElement.style.margin = '0'
      bannerElement.style.padding = '0'
      bannerElement.innerHTML = ''
      return
    }

    bannerElement.classList.remove('hidden')
    bannerElement.style.background = 'rgba(255, 152, 0, 0.15)'
    bannerElement.style.borderLeft = '4px solid #ff9800'
    bannerElement.style.padding = '12px 16px'
    bannerElement.style.margin = '10px 16px'
    bannerElement.style.borderRadius = '4px'
    bannerElement.style.display = 'flex'
    bannerElement.style.justifyContent = 'space-between'
    bannerElement.style.alignItems = 'center'
    bannerElement.style.fontSize = '13px'
    bannerElement.style.color = '#ccc'

    const session = currentSessions[0]
    const dateStr = new Date(session.updatedAt).toLocaleTimeString()
    const promptSnippet = session.prompt ? `"${session.prompt.slice(0, 40)}..."` : 'Session CLI'

    bannerElement.innerHTML = `
      <div style="flex: 1; margin-right: 16px;">
        <strong>Session interrompue détectée :</strong> ${promptSnippet} (active à ${dateStr}). Voulez-vous reprendre ?
      </div>
      <div style="display: flex; gap: 8px;">
        <button id="btnResumeYes" class="primaryButton compact" style="background: #ff9800; border: none; color: #000; padding: 4px 12px; cursor: pointer; border-radius: 4px; font-weight: bold;">Reprendre</button>
        <button id="btnResumeNo" class="secondaryButton" style="padding: 4px 12px; cursor: pointer; border-radius: 4px;">Ignorer</button>
      </div>
    `

    document.getElementById('btnResumeYes').addEventListener('click', () => {
      onResume(session)
      currentSessions = []
      render()
    })

    document.getElementById('btnResumeNo').addEventListener('click', () => {
      onDismiss(session)
      currentSessions = []
      render()
    })
  }

  function show(sessions) {
    currentSessions = sessions || []
    render()
  }

  return {
    show
  }
}
