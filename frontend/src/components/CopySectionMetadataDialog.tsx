import { ConfirmDialog } from '../components/Dialog';
import { MaterialIcon, getModeIcon } from '../components/MaterialIcon';
import type { CopySectionMetadataData } from '../utils/useCopySectionMetadata';

interface CopySectionMetadataDialogProps {
  offer: CopySectionMetadataData | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CopySectionMetadataDialog({ offer, onConfirm, onCancel }: CopySectionMetadataDialogProps) {
  if (!offer) return null;

  return (
    <ConfirmDialog
      isOpen={!!offer}
      title={offer.newName ? "Apply Style Settings?" : "Copy Color?"}
      message={
        offer.newName ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", alignItems: "flex-start", marginTop: "12px" }}>
            <div>
              A segment with the name <strong style={{ color: "#111" }}>{offer.newName}</strong> already exists.
            </div>
            <div style={{ marginBottom: "8px", color: "#555" }}>
              {offer.routingProfile
                ? "Would you like to copy its icon, mode, color, and routing profile?"
                : "Would you like to copy its icon, mode, and color?"}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "12px", border: "1px solid #ddd", padding: "12px", borderRadius: "8px", backgroundColor: "#f5f5f5", width: "100%", boxSizing: "border-box" }}>
              <span style={{ color: offer.color, display: "flex", justifySelf: "center" }}>
                {offer.mode === 'other' && offer.icon ? <MaterialIcon name={offer.icon} size={28} /> : getModeIcon((offer.mode as any) || 'other', 28)}
              </span>
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: "14px", fontWeight: "bold", textTransform: "capitalize" }}>
                  {offer.mode}
                </div>
                {offer.routingProfile && (
                  <div style={{ fontSize: "12px", color: "#666", marginTop: "2px" }}>
                    Routing: {offer.routingService ? `${offer.routingService.replace(' Router', '')} [${offer.routingProfile}]` : offer.routingProfile}
                  </div>
                )}
              </div>
              <div style={{ padding: "4px 8px", backgroundColor: offer.color, color: "#fff", borderRadius: "4px", fontSize: "12px", fontWeight: "bold", textTransform: "uppercase" }}>
                {offer.color}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: "12px" }}>
            Found another segment with the custom icon "{offer.icon}" and a custom color
            <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: offer.color, marginLeft: '6px', marginRight: '2px', verticalAlign: 'middle', border: '1px solid #ccc' }}></span>
            <strong style={{ color: offer.color }}>{offer.color}</strong>.<br/><br/>
            Would you like to use this color for the current segment too?
          </div>
        )
      }
      confirmLabel={offer.newName ? "Apply Style" : "Yes, copy color"}
      cancelLabel={offer.newName ? "No, leave as is" : "No, thanks"}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
