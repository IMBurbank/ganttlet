/// <reference types="vite/client" />

interface GanttletConfig {
  googleClientId?: string;
  collabUrl?: string;
}

interface Window {
  __ganttlet_config?: GanttletConfig;
}
