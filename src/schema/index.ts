export {
  migrateDoc,
  getDocMaps,
  writeTaskToDoc,
  yMapToTask,
  TASK_FIELDS,
  CURRENT_MAJOR,
  CURRENT_MINOR,
  type MigrateResult,
  type DocMaps,
} from './ydoc';
// FIELD_REGISTRY is intentionally NOT exported — it's an implementation detail.
// Consumers use TASK_FIELDS (derived from the registry) for field enumeration.
export { MIGRATIONS, type Migration } from './migrations';
