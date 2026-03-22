import { templates } from '../../data/templates';

interface TemplatePickerProps {
  onSelect: (templateId: string) => void;
  onClose?: () => void;
}

export default function TemplatePicker({ onSelect, onClose }: TemplatePickerProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      data-testid="template-picker"
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div className="bg-surface-base rounded-xl shadow-lg max-w-2xl w-full mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">Choose a template</h2>
          {onClose && (
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text-primary transition-colors"
              data-testid="template-picker-close"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {templates.map((template) => (
            <button
              key={template.id}
              onClick={() => onSelect(template.id)}
              className="flex flex-col items-start p-4 rounded-lg border border-border-default hover:border-blue-400 hover:bg-surface-hover transition-colors text-left"
              data-testid={`template-card-${template.id}`}
            >
              <span className="text-sm font-medium text-text-primary">{template.name}</span>
              <span className="text-xs text-text-muted mt-1">{template.description}</span>
              {template.taskCount > 0 && (
                <span className="text-xs text-text-muted mt-2">{template.taskCount} tasks</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
