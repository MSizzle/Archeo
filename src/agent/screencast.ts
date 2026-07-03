/**
 * src/agent/screencast.ts
 *
 * DASH-04 — the ONLY CDP screencast wiring. Lives in src/agent so src/dashboard never imports
 * playwright; frames are forwarded to a callback, never pulled by the dashboard.
 *
 * No TypeScript enums. .ts import extensions.
 */
import type { BrowserContext, Page } from 'playwright'

export interface ScreencastHandle {
  stop(): Promise<void>
}

export async function startScreencast(
  context: BrowserContext,
  page: Page,
  onFrame: (frameBase64: string) => void,
  opts?: { everyNthFrame?: number; quality?: number },
): Promise<ScreencastHandle> {
  const cdp = await context.newCDPSession(page)
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: opts?.quality ?? 50,
    everyNthFrame: opts?.everyNthFrame ?? 8,
  })
  cdp.on('Page.screencastFrame', (evt: { data: string; sessionId: number }) => {
    try {
      onFrame(evt.data)
    } catch {
      // frame-handler errors must never crash the run (fail-safe, T-05-18)
    }
    cdp.send('Page.screencastFrameAck', { sessionId: evt.sessionId }).catch(() => {})
  })
  let stopped = false
  return {
    stop: async () => {
      if (stopped) return
      stopped = true
      try { await cdp.send('Page.stopScreencast') } catch {}
      try { await cdp.detach() } catch {}
    },
  }
}
