// The linewatch theme. `astryx experimental theme editor` wrote this file once and never changes it again.
// The checked settings live in linewatch.settings.json and the generated linewatch.settings.ts;
// change them with `astryx experimental theme editor set linewatch ...`. Add your own changes below: they win over the settings.
import {defineTheme} from '@astryxdesign/core/theme';
import {linewatchSettings} from './linewatch.settings';

export const linewatchTheme = defineTheme({
  extends: linewatchSettings,
  name: 'linewatch',
});
