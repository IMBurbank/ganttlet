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
          boxShadow: showRing ? `0 0 0 2px #0f172a, 0 0 0 4px ${color}` : undefined,
        }}
      >
        {initials}
      </div>
      {isOnline !== undefined && (
        <div
          className={`absolute bottom-0 right-0 rounded-full border-2 border-gray-950 ${isOnline ? 'bg-green-400 pulse-dot' : 'bg-gray-500'}`}
          style={{ width: size * 0.3, height: size * 0.3 }}
        />
      )}
    </div>
  );
}
