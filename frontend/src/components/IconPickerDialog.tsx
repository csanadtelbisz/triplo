import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import materialIconsData from '../assets/material-icons/google-material-icons-metadata.json';
import customIconsData from '../assets/material-icons/custom-icons-metadata.json';
import { getCustomOtherModes } from '../utils/customModesPreferences';

interface IconPickerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onPick: (iconId: string) => void;
}

export function IconPickerDialog({ isOpen, onClose, onPick }: IconPickerDialogProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null);
  
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the search input when the dialog opens
  useEffect(() => {
    if (isOpen) {
      // A brief timeout ensures the dialog is fully mounted in the DOM before focusing
      const timeoutId = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [isOpen]);

  // Handle cleanup gracefully without triggering cascading renders in a useEffect
  const handleClose = () => {
    setSearchQuery('');
    setSelectedIcon(null);
    onClose();
  };

  const allIcons = useMemo(() => {
    return [...customIconsData.icons, ...materialIconsData.icons];
  }, []);

  const filteredIcons = useMemo(() => {
    const query = searchQuery.trim().replaceAll(/[-_]/g, ' ').toLowerCase();
    if (!query) return [];

    const customModes = getCustomOtherModes();

    const matched = allIcons.filter(icon => {
      const matchesCustomMode = customModes.some(cm => {
        if (!cm.icon || !cm.name) return false;
        if (cm.icon.toLowerCase() !== icon.name.toLowerCase()) return false;
        const modeName = cm.name.toLowerCase();
        const modeNameNormalized = modeName.replaceAll(/[-_]/g, ' ');
        return modeName.includes(query) || modeNameNormalized.includes(query);
      });

      return (
        icon.name.toLowerCase().includes(query) ||
        icon.name.toLowerCase().replaceAll(/[-_]/g, ' ').includes(query) ||
        icon.tags?.some((tag: string) => tag.toLowerCase().includes(query)) ||
        icon.categories?.some((cat: string) => cat.toLowerCase().includes(query)) ||
        matchesCustomMode
      );
    });

    const existingMatchedNames = new Set(matched.map(i => i.name.toLowerCase()));
    for (const cm of customModes) {
      if (cm.icon && !existingMatchedNames.has(cm.icon.toLowerCase())) {
        const modeName = (cm.name || '').toLowerCase();
        const modeNameNormalized = modeName.replaceAll(/[-_]/g, ' ');
        if (modeName.includes(query) || modeNameNormalized.includes(query)) {
          matched.push({ name: cm.icon, categories: [], tags: [] });
          existingMatchedNames.add(cm.icon.toLowerCase());
        }
      }
    }

    return matched;
  }, [searchQuery, allIcons]);

  const handlePick = () => {
    if (selectedIcon) {
      onPick(selectedIcon);
      handleClose();
    }
  };

  const dialogActions = (
    <>
      <button className="dialog-btn dialog-btn-cancel" onClick={handleClose}>
        Cancel
      </button>
      <button
        className="dialog-btn dialog-btn-primary"
        onClick={handlePick}
        disabled={!selectedIcon}
        style={{ opacity: selectedIcon ? 1 : 0.5, cursor: selectedIcon ? 'pointer' : 'not-allowed' }}
      >
        Pick
      </button>
    </>
  );

  return (
    <Dialog
      isOpen={isOpen}
      title="Pick an Icon"
      onClose={handleClose}
      actions={dialogActions}
      className="icon-picker-dialog"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search icons (e.g., 'water', 'trolley', 'arrow')..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            padding: '8px 12px',
            fontSize: '16px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            width: '100%',
            boxSizing: 'border-box'
          }}
        />

        {!searchQuery && (
          <p style={{ color: '#666', textAlign: 'center', margin: '24px 0' }}>
            Type to search for an icon.
          </p>
        )}

        {searchQuery && filteredIcons.length === 0 && (
          <p style={{ color: '#666', textAlign: 'center', margin: '24px 0' }}>
            No icons found matching "{searchQuery}".
          </p>
        )}

        {filteredIcons.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              maxHeight: '350px',
              overflowY: 'auto',
              padding: '4px' // prevent cut-off focus rings/borders
            }}
          >
            {filteredIcons.map((icon) => {
              const isSelected = selectedIcon === icon.name;
              
              const baseStyle: React.CSSProperties = {
                width: '36px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                borderRadius: '4px',
                opacity: 1,
                color: 'black',
              };
              
              const activeStyle: React.CSSProperties = {
                ...baseStyle,
                border: '2px solid rgb(0, 123, 255)',
                background: 'rgb(230, 242, 255)'
              };
              
              const inactiveStyle: React.CSSProperties = {
                ...baseStyle,
                border: '1px solid rgb(204, 204, 204)',
                background: 'rgb(249, 249, 249)'
              };

              return (
                <div
                  key={icon.name}
                  title={icon.name}
                  onClick={() => setSelectedIcon(icon.name)}
                  style={isSelected ? activeStyle : inactiveStyle}
                >
                  <Icon name={icon.name} size={20} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Dialog>
  );
}