import React from 'react';
import { useCollaborationStore } from '../stores';

interface CollaborationOverlayProps {
  width: number;
  height: number;
}

export const CollaborationOverlay: React.FC<CollaborationOverlayProps> = () => {
  const users = useCollaborationStore((s) => s.users);

  const otherOnlineUsers = users.filter((u) => !u.isYou && u.isOnline);

  if (otherOnlineUsers.length === 0) return null;

  return (
    <g className="collaboration-overlay" pointerEvents="none">
      {otherOnlineUsers.map((user) => (
        <g
          key={user.id}
          style={{
            transition: 'transform 0.5s ease-out',
            transform: `translate(${user.cursorX}px, ${user.cursorY}px)`,
          }}
        >
          {/* Cursor arrow */}
          <path
            d="M0 0 L0 16 L4.5 12.5 L8.5 19.5 L11 18 L7 11 L12.5 9.5 Z"
            fill={user.avatarColor}
            stroke="rgba(0,0,0,0.3)"
            strokeWidth={0.5}
          />

          {/* Name label */}
          <g transform="translate(14, 18)">
            <rect
              x={-2}
              y={-9}
              width={user.name.length * 6 + 8}
              height={14}
              rx={3}
              fill={user.avatarColor}
              opacity={0.9}
            />
            <text
              x={2}
              y={2}
              fontSize={10}
              fontWeight={500}
              fill="white"
              fontFamily="system-ui, sans-serif"
            >
              {user.name}
            </text>
          </g>
        </g>
      ))}
    </g>
  );
};
