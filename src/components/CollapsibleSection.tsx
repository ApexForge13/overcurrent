"use client";
import { useState, useRef, useEffect } from "react";

interface CollapsibleSectionProps {
  title: string;
  preview: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function CollapsibleSection({ title, preview, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(defaultOpen ? undefined : 0);
  // After opening animation completes, switch to auto so nested content can resize freely
  const [settled, setSettled] = useState(defaultOpen);

  useEffect(() => {
    if (isOpen) {
      setSettled(false);
      const el = contentRef.current;
      if (el) {
        setHeight(el.scrollHeight);
        // After the CSS transition ends (~200ms), switch to auto height
        const timer = setTimeout(() => setSettled(true), 220);
        return () => clearTimeout(timer);
      }
    } else {
      setSettled(false);
      setHeight(0);
    }
  }, [isOpen]);

  return (
    <div className="mt-0">
      {/* Section rule header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 py-6 group cursor-pointer"
        style={{ borderTop: '1px solid var(--border-primary)' }}
      >
        <div style={{ flex: 1, height: '1px', background: 'var(--border-primary)' }} />
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
          whiteSpace: 'nowrap',
        }}>
          {title}
        </span>
        <div style={{ flex: 1, height: '1px', background: 'var(--border-primary)' }} />
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '14px',
          color: 'var(--text-tertiary)',
          transition: 'transform 200ms ease',
          transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
          display: 'inline-block',
        }}>
          ▸
        </span>
      </button>

      {/* Preview when collapsed */}
      {!isOpen && preview && (
        <p
          onClick={() => setIsOpen(true)}
          className="cursor-pointer -mt-3 mb-2"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            color: 'var(--text-tertiary)',
            paddingLeft: '4px',
          }}
        >
          {preview}
        </p>
      )}

      {/* Collapsible content — uses 'auto' after animation settles so nested sections can resize */}
      <div
        style={{
          height: isOpen
            ? (settled ? 'auto' : (height !== undefined ? `${height}px` : 'auto'))
            : '0px',
          overflow: settled ? 'visible' : 'hidden',
          transition: settled ? 'none' : 'height 200ms ease',
        }}
      >
        <div ref={contentRef}>
          {children}
        </div>
      </div>
    </div>
  );
}
