import React from 'react';
import '../styles/Dialog.css';

interface DialogProps {
  isOpen: boolean;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  onClose: () => void;
}

export function Dialog({
  isOpen,
  title,
  children,
  actions,
  onClose
}: DialogProps) {
  if (!isOpen) return null;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-content" onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog-title">{title}</h3>
        <div className="dialog-message">{children}</div>
        {actions && (
          <div className="dialog-actions">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
