import { useEffect, useRef } from "react";

/**
 * Full-bleed screenshot view. Kept keyboard-complete on purpose: it opens from
 * a button, takes focus, closes on Escape or click, and returns focus on close.
 */
export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    ref.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  return (
    <button className="lightbox" type="button" onClick={onClose} aria-label="Close screenshot" ref={ref}>
      <img src={src} alt="Enlarged device screenshot" />
    </button>
  );
}
