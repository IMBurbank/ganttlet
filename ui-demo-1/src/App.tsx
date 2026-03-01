import { useEffect } from 'react';
import { AppShell } from './components/AppShell';
import { generateSeedData } from './data/seed';
import {
  useTaskStore,
  useDependencyStore,
  useResourceStore,
  useHistoryStore,
  useCollaborationStore,
} from './stores';
import { useCPM } from './hooks/useCPM';
import { useCollaborationSim } from './hooks/useCollaborationSim';
import { useKeyboardNav } from './hooks/useKeyboardNav';

function App() {
  useEffect(() => {
    const data = generateSeedData();
    useTaskStore.getState().setTasks(data.tasks);
    useTaskStore.getState().setProjects(data.projects);
    useTaskStore.getState().setWorkstreams(data.workstreams);
    useDependencyStore.getState().setDependencies(data.dependencies);
    useResourceStore.getState().setResources(data.resources);
    useHistoryStore.getState().setRecords(data.changeRecords);
    useCollaborationStore.getState().setUsers(data.collaborationUsers);
  }, []);

  // Run CPM analysis, collaboration sim, keyboard nav
  useCPM();
  useCollaborationSim();
  useKeyboardNav();

  return <AppShell />;
}

export default App;
