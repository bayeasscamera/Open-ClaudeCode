(function () {
  function closestElement(node, elementNodeType = 1) {
    if (!node) return null
    return node.nodeType === elementNodeType ? node : node.parentElement
  }

  function isSelectableReportTarget(target) {
    return Boolean(target?.closest?.('.bubble, .activityPanel, .timeline, .diagnostics'))
      && !target.closest('button, input, textarea, select, a')
  }

  function isEditableTarget(target) {
    return Boolean(target?.closest?.('input, textarea, select'))
  }

  function install({ doc = document, win = window, copyText = () => false } = {}) {
    let lastReportSelection = null
    const elementNodeType = win.Node?.ELEMENT_NODE || 1

    function holdReportSelection(durationMs = 4000) {
      win.__opcReportSelectionHoldUntil = Math.max(
        win.__opcReportSelectionHoldUntil || 0,
        Date.now() + durationMs,
      )
    }

    function rememberSelectionText(selectedText) {
      if (!selectedText.trim()) return
      holdReportSelection()
      lastReportSelection = {
        text: selectedText,
        expiresAt: Date.now() + 30000,
      }
      win.__opcLastSelectedReportText = selectedText
    }

    function clearRememberedSelection() {
      lastReportSelection = null
      win.__opcLastSelectedReportText = ''
      win.__opcReportSelectionHoldUntil = 0
    }

    function hasActiveReportSelection() {
      const selection = win.getSelection()
      const selectedText = selection?.toString() || ''
      if (!selection || selection.isCollapsed || !selectedText.trim()) return false
      const anchor = closestElement(selection.anchorNode, elementNodeType)
      const focus = closestElement(selection.focusNode, elementNodeType)
      return isSelectableReportTarget(anchor) || isSelectableReportTarget(focus)
    }

    function selectedReportText() {
      const selectedText = win.getSelection()?.toString() || ''
      if (selectedText.trim()) return selectedText
      if (lastReportSelection?.text && lastReportSelection.expiresAt > Date.now()) return lastReportSelection.text
      clearRememberedSelection()
      return ''
    }

    doc.addEventListener('mousedown', event => {
      if (!isSelectableReportTarget(event.target)) clearRememberedSelection()
    }, true)

    doc.addEventListener('selectionchange', () => {
      const selection = win.getSelection()
      const selectedText = selection?.toString() || ''
      if (!selectedText.trim()) return
      const anchor = closestElement(selection.anchorNode, elementNodeType)
      const focus = closestElement(selection.focusNode, elementNodeType)
      if (isSelectableReportTarget(anchor) || isSelectableReportTarget(focus)) {
        rememberSelectionText(selectedText)
      }
    })

    doc.addEventListener('keydown', event => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'c' || isEditableTarget(event.target)) return
      const selectedText = selectedReportText()
      if (!selectedText?.trim()) return
      holdReportSelection(5000)
      event.preventDefault()
      copyText(selectedText)
    })

    doc.addEventListener('copy', event => {
      if (isEditableTarget(event.target)) return
      const selectedText = selectedReportText()
      if (!selectedText?.trim()) return
      holdReportSelection(5000)
      event.clipboardData?.setData('text/plain', selectedText)
      event.preventDefault()
    })

    win.__opcIsReportSelectionActive = hasActiveReportSelection
    return {
      clearRememberedSelection,
      hasActiveReportSelection,
      selectedReportText,
    }
  }

  window.OPCReportSelection = {
    install,
    isSelectableReportTarget,
  }
})()
