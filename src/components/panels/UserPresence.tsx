import React from 'react';
import Avatar from '../shared/Avatar';
import Tooltip from '../shared/Tooltip';
import { useCollab } from '../../hooks/useCollab';

export default function UserPresence() {
  const { collabUsers, isCollabConnected } = useCollab();

  if (!isCollabConnected || collabUsers.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center -space-x-2">
      {collabUsers.map((user) => {
        const initials = user.name
          .split(' ')
          .map((part) => part[0])
          .join('')
          .toUpperCase()
          .slice(0, 2);

        return (
          <Tooltip
            key={user.clientId}
            content={
              <div>
                <span className="font-medium text-text-primary">{user.name}</span>
                <span className="ml-2 text-xs text-green-400">Online</span>
                {user.viewingTaskId && (
                  <div className="text-text-secondary text-xs mt-0.5">
                    Viewing: {user.viewingTaskId}
                  </div>
                )}
              </div>
            }
          >
            <Avatar initials={initials || '?'} color={user.color} size={28} isOnline={true} />
          </Tooltip>
        );
      })}
    </div>
  );
}
