import { CONFIG_DIR_NAME } from '../../utils/brand.js'

// In its own file to avoid circular dependencies
export const FILE_EDIT_TOOL_NAME = 'Edit'

// Permission pattern for granting session-level access to the project's config folder
export const HELION_FOLDER_PERMISSION_PATTERN = `/${CONFIG_DIR_NAME}/**`

// Permission pattern for granting session-level access to the global config folder
export const GLOBAL_HELION_FOLDER_PERMISSION_PATTERN = `~/${CONFIG_DIR_NAME}/**`

export const FILE_UNEXPECTEDLY_MODIFIED_ERROR =
  'File has been unexpectedly modified. Read it again before attempting to write it.'
