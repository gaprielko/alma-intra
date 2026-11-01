import { useCallback, useEffect, useRef } from 'react';

export interface FrameRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * What the frame's bridge reports. The document's own scripts could send any of this, so nothing here
 * is trusted: numbers and rectangles only place overlays, text is shown as text, and what the server
 * does with a block number it decides on its own source (docs/file-sharing.md 9.2).
 */
export type BridgeMessage =
  | { type: 'ready' }
  | {
      type: 'hover';
      block: number | null;
      change?: string | null;
      editable?: boolean;
      textable?: boolean;
      pendingInside?: boolean;
      tag?: string;
      src?: string | null;
      text?: string | null;
      parent?: boolean;
      rect?: FrameRect;
    }
  | { type: 'hover-out' }
  | { type: 'rect'; rect: FrameRect }
  | {
      type: 'selection';
      text: string | null;
      prefix?: string;
      suffix?: string;
      block?: number | null;
      rect?: FrameRect;
    }
  | { type: 'comment-click'; id: string }
  | { type: 'comments-placed'; unplaced: string[]; order: string[] };

const KNOWN = new Set([
  'ready',
  'hover',
  'hover-out',
  'rect',
  'selection',
  'comment-click',
  'comments-placed',
]);

/** A message only counts from this frame's own window, and only in the shape we know. */
function parse(data: unknown): BridgeMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const message = data as { alma?: unknown; type?: unknown };
  if (message.alma !== 1 || typeof message.type !== 'string' || !KNOWN.has(message.type)) {
    return null;
  }
  return data as BridgeMessage;
}

/**
 * A shared document in its isolated frame: the same sandbox as the response's own policy, without
 * `allow-same-origin`, so it has no access to this page or its cookies.
 */
export function DocFrame({
  src,
  title,
  onMessage,
  sendRef,
}: {
  src: string;
  title: string;
  onMessage: (message: BridgeMessage) => void;
  sendRef?: { current: ((message: Record<string, unknown>) => void) | null };
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const handler = useRef(onMessage);
  handler.current = onMessage;

  const send = useCallback((message: Record<string, unknown>) => {
    // An opaque origin has no name to address it by; the content is the page's own.
    frame.current?.contentWindow?.postMessage(message, '*');
  }, []);
  useEffect(() => {
    if (sendRef) sendRef.current = send;
  }, [send, sendRef]);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message = parse(event.data);
      if (message) handler.current(message);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);

  return (
    <iframe
      ref={frame}
      title={title}
      src={src}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      className="block h-full w-full border-0 bg-white"
    />
  );
}
