import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import '../styles/Dialog.css';

interface DialogProps {
  isOpen: boolean;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  onClose: () => void;
  className?: string;
}

export function Dialog({
  isOpen,
  title,
  children,
  actions,
  onClose,
  className
}: DialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="dialog-overlay" onClick={onClose}>
      <div className={`dialog-content${className ? ` ${className}` : ''}`} onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog-title">{title}</h3>
        <div className="dialog-message" style={{ marginBottom: actions ? '24px' : '0' }}>
          {children}
        </div>
        {actions && (
          <div className="dialog-actions">
            {actions}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const confirmClass = confirmVariant === 'danger' ? 'dialog-btn-confirm' : 'dialog-btn-primary';

  return (
    <Dialog
      isOpen={isOpen}
      title={title}
      onClose={onCancel}
      actions={
        <>
          <button className="dialog-btn dialog-btn-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={`dialog-btn ${confirmClass}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {message}
    </Dialog>
  );
}
