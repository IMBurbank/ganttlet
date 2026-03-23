import React from 'react';

interface AvatarProps {
  initials: string;
  color: string;
  size?: number;
  showRing?: boolean;
  isOnline?: boolean;
}

export default function Avatar({ initials, color, size = 32, showRing, isOnline }: AvatarProps) {
  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <div
        className="flex items-center justify-center rounded-full text-white font-semibold"
        style={{
          width: size,
          height: size,
          backgroundColor: color,
          fontSize: size * 0.38,
          boxShadow: showRing ? `0 0 0 2px var(--raw-avatar-ring), 0 0 0 4px ${color}` : undefined,
        }}
      >
        {initials}
      </div>
      {isOnline !== undefined && (
        <div
          className={`absolute bottom-0 right-0 rounded-full border-2 border-surface-base ${isOnline ? 'bg-green-400 pulse-dot' : 'bg-gray-500'}`}
          data-testid="presence-indicator"
          style={{ width: size * 0.3, height: size * 0.3 }}
        />
      )}
    </div>
  );
}
