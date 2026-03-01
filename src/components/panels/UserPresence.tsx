import React from 'react';
import { useGanttState } from '../../state/GanttContext';
import Avatar from '../shared/Avatar';
import Tooltip from '../shared/Tooltip';

export default function UserPresence() {
  const { users, collabUsers, isCollabConnected } = useGanttState();

  if (isCollabConnected && collabUsers.length > 0) {
    return (
      <div className="flex items-center -space-x-2">
        {collabUsers.map(user => {
          const initials = user.name
            .split(' ')
            .map(part => part[0])
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
              <Avatar
                initials={initials || '?'}
                color={user.color}
                size={28}
                isOnline={true}
              />
            </Tooltip>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex items-center -space-x-2">
      {users.map(user => (
        <Tooltip
          key={user.id}
          content={
            <div>
              <span className="font-medium text-text-primary">{user.name}</span>
              <span className={`ml-2 text-xs ${user.isOnline ? 'text-green-400' : 'text-text-muted'}`}>
                {user.isOnline ? 'Online' : 'Offline'}
              </span>
              {user.viewingTaskId && (
                <div className="text-text-secondary text-xs mt-0.5">Viewing: {user.viewingTaskId}</div>
              )}
            </div>
          }
        >
          <Avatar
            initials={user.avatar}
            color={user.color}
            size={28}
            isOnline={user.isOnline}
          />
        </Tooltip>
      ))}
    </div>
  );
}
