import { useCallback, useEffect, useState } from 'react'

/**
 * Subscribes to the main process's Play tab health check (see
 * src/main/services/playTabHealth.js) for as long as the app is open, not
 * scoped to whether the Play screen is currently mounted — the same reason
 * useScreenRecording() (lib/recording.js) lives above the per-screen render
 * tree rather than inside PlayScreen.jsx: the Play embed keeps running in
 * the background (recording or otherwise) even while the user is on
 * another screen, and a prompt raised while they're away should still be
 * there when they come back to the Play tab, not missed because nothing was
 * listening for it at the time.
 *
 * The health check only ever reaches this prompt path when a recording or
 * tracked match session is active — an idle Play tab reloads itself
 * automatically with no renderer involvement at all, so this hook has
 * nothing to do in that case.
 */
export function usePlayTabHealthPrompt() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const unsubShow = window.api.playTabHealth.onShowPrompt(() => setVisible(true))
    const unsubHide = window.api.playTabHealth.onHidePrompt(() => setVisible(false))
    return () => {
      unsubShow()
      unsubHide()
    }
  }, [])

  const confirmReload = useCallback(() => {
    window.api.playTabHealth.confirmReload()
  }, [])

  const dismiss = useCallback(() => {
    window.api.playTabHealth.dismissPrompt()
    setVisible(false)
  }, [])

  return { visible, confirmReload, dismiss }
}
