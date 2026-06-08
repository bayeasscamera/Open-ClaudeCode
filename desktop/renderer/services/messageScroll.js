(function () {
  function createMessageScrollController(element, { followThreshold = 24 } = {}) {
    let autoFollow = true
    let programmaticScrollTop = null

    function distanceFromBottom() {
      return Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight)
    }

    function setScrollTop(value) {
      element.scrollTop = value
      programmaticScrollTop = element.scrollTop
    }

    function shouldFollow() {
      return autoFollow || distanceFromBottom() <= 2
    }

    function reset() {
      autoFollow = true
      programmaticScrollTop = null
    }

    function scrollToBottom() {
      setScrollTop(element.scrollHeight)
    }

    function preserve(scrollTop) {
      setScrollTop(scrollTop)
    }

    function childNodes() {
      return Array.from(element?.children || [])
    }

    function captureAnchor() {
      const scrollTop = element.scrollTop || 0
      const children = childNodes()
      for (const child of children) {
        const top = Number(child.offsetTop || 0)
        const height = Number(child.offsetHeight || child.clientHeight || 0)
        if (top + height >= scrollTop) {
          return {
            id: child.dataset?.messageId || '',
            offset: scrollTop - top,
            scrollTop,
          }
        }
      }
      return { id: '', offset: 0, scrollTop }
    }

    function restoreAnchor(anchor) {
      if (!anchor) return
      if (anchor.id) {
        const target = childNodes().find(child => child.dataset?.messageId === anchor.id)
        if (target) {
          setScrollTop(Number(target.offsetTop || 0) + Number(anchor.offset || 0))
          return
        }
      }
      preserve(anchor.scrollTop || 0)
    }

    if (element?.addEventListener) {
      element.addEventListener('scroll', () => {
        if (programmaticScrollTop !== null && Math.abs(element.scrollTop - programmaticScrollTop) < 1) {
          programmaticScrollTop = null
          return
        }
        programmaticScrollTop = null
        autoFollow = distanceFromBottom() <= followThreshold
      }, { passive: true })
    }

    return {
      captureAnchor,
      distanceFromBottom,
      preserve,
      reset,
      restoreAnchor,
      scrollToBottom,
      shouldFollow,
    }
  }

  window.OPCMessageScroll = { createMessageScrollController }
})()
