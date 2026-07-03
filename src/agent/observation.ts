/**
 * src/agent/observation.ts
 *
 * AGENT-01; the DOM walk is a string run in the browser; only normalizeInventory is
 * unit-tested here; captureObservation is integration-proven in 05-05.
 */
import type { ChatContentPart } from '../model/types.ts'
import type { Page } from 'playwright'
import { annotateBlocklist } from './blocklist.ts'

export interface InventoryElement {
  ref: number
  tag: string
  role?: string
  text?: string
  href?: string
  inputType?: string
  inputName?: string
  bbox: { x: number; y: number; w: number; h: number }
  blocked: boolean
}

export interface Observation {
  url: string
  title: string
  screenshot: ChatContentPart
  inventory: InventoryElement[]
}

interface RawEl {
  tag: string
  role?: string
  text?: string
  href?: string
  inputType?: string
  inputName?: string
  bbox: { x: number; y: number; w: number; h: number }
  visible: boolean
}

/**
 * Browser function string for page.evaluate.
 * Collects all interactive elements and returns their shape + bounding box.
 */
export const INVENTORY_BROWSER_FN: string = `(function() {
  const selectors = 'a,button,input,select,textarea,[role="button"],[role="link"],[onclick]';
  const els = Array.from(document.querySelectorAll(selectors));
  return els.map(el => {
    const bbox = el.getBoundingClientRect();
    const visible = bbox.width > 0 && bbox.height > 0 &&
      window.getComputedStyle(el).visibility !== 'hidden' &&
      window.getComputedStyle(el).display !== 'none';
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || undefined,
      text: el.innerText || el.textContent || undefined,
      href: el.getAttribute('href') || undefined,
      inputType: el.getAttribute('type') || undefined,
      inputName: el.getAttribute('name') || undefined,
      bbox: { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height },
      visible,
    };
  });
})()`

/**
 * Normalize a raw browser element list into a typed InventoryElement array.
 *
 * Steps:
 *   1. Filter to visible elements with non-zero bounding box
 *   2. Assign stable sequential ref indices
 *   3. Truncate text to 80 chars
 *   4. Apply blocklist annotation
 */
export function normalizeInventory(raw: RawEl[]): InventoryElement[] {
  const visible = raw.filter((el) => el.visible && el.bbox.w > 0 && el.bbox.h > 0)

  const list: InventoryElement[] = visible.map((el, idx) => ({
    ref: idx,
    tag: el.tag,
    role: el.role,
    text: el.text?.slice(0, 80),
    href: el.href,
    inputType: el.inputType,
    inputName: el.inputName,
    bbox: el.bbox,
    blocked: false,
  }))

  return annotateBlocklist(list)
}

/**
 * Capture a full observation from the current page state.
 * THIN wrapper — not unit tested (integration proven in 05-05).
 */
export async function captureObservation(page: Page): Promise<Observation> {
  const raw = await page.evaluate(INVENTORY_BROWSER_FN)
  const inventory = normalizeInventory(raw as RawEl[])
  const buf = await page.screenshot({ type: 'jpeg', quality: 60 })
  const screenshot: ChatContentPart = {
    type: 'image',
    mediaType: 'image/jpeg',
    dataBase64: buf.toString('base64'),
  }
  return {
    url: page.url(),
    title: await page.title(),
    screenshot,
    inventory,
  }
}
