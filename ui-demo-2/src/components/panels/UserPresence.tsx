import React from 'react';
import { useGanttState } from '../../state/GanttContext';
import Avatar from '../shared/Avatar';
import Tooltip from '../shared/Tooltip';

export default function UserPresence() {
  const { users } = useGanttState();

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
